package epub

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestPackerSpoolCleanupOnSuccessFailureAndCancel(t *testing.T) {
	t.Parallel()

	t.Run("success removes spool files and uses 0600 mode", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		packer, err := newTestBuilder(Config{MaxEPUBBytes: 200 * 1024, SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15", domain.KindleLanguageChinese)
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}
		defer func() { _ = packer.Close() }()

		for i := range 4 {
			err := packer.AddArticle(context.Background(), domain.KindleArticle{
				ID:       fmt.Sprintf("a-%d", i+1),
				Title:    fmt.Sprintf("篇 %d", i+1),
				HTMLBody: "<p>" + randomText(t, 100*1024) + "</p>",
			})
			if err != nil {
				t.Fatalf("AddArticle(%d) error = %v", i, err)
			}
		}

		count, err := packer.Finish(context.Background())
		if err != nil {
			t.Fatalf("Finish() error = %v", err)
		}
		if count != 2 {
			t.Fatalf("Finish() count = %d, want 2", count)
		}

		entries, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(entries) != 2 {
			t.Fatalf("spool entries after Finish = %d, want 2", len(entries))
		}
		for _, entry := range entries {
			info, err := os.Stat(filepath.Join(spoolDir, entry.Name()))
			if err != nil {
				t.Fatalf("Stat(%s) error = %v", entry.Name(), err)
			}
			if perm := info.Mode().Perm(); perm != 0o600 {
				t.Fatalf("spool file %s mode = %o, want 0600", entry.Name(), perm)
			}
		}

		for i := range count {
			book, err := packer.ReadBook(context.Background(), i)
			if err != nil {
				t.Fatalf("ReadBook(%d) error = %v", i, err)
			}
			if len(book.Data) == 0 {
				t.Fatalf("ReadBook(%d) returned empty data", i)
			}
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() after Close error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after success: %v", remaining)
		}
	})

	t.Run("oversize text-only failure cleans up prior spool files", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		packer, err := newTestBuilder(Config{MaxEPUBBytes: 64 * 1024, SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15", domain.KindleLanguageChinese)
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}

		if err := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       "ok-1",
			Title:    "正常文章",
			HTMLBody: "<p>" + randomText(t, 40*1024) + "</p>",
		}); err != nil {
			t.Fatalf("AddArticle(ok) error = %v", err)
		}

		addErr := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       "too-big",
			Title:    "超大纯文本",
			HTMLBody: "<p>" + randomText(t, 128*1024) + "</p>",
		})
		if addErr == nil || !strings.Contains(addErr.Error(), "even without images") {
			t.Fatalf("AddArticle(too-big) error = %v, want even without images oversize error", addErr)
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after failure: %v", remaining)
		}
	})

	t.Run("context cancel cleans up spool files", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		ctx, cancel := context.WithCancel(context.Background())
		packer, err := newTestBuilder(Config{MaxEPUBBytes: 128 * 1024, SpoolDir: spoolDir}).NewPacker(ctx, "2026-03-15", domain.KindleLanguageChinese)
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}

		if err := packer.AddArticle(ctx, domain.KindleArticle{
			ID:       "ok-1",
			Title:    "第一篇",
			HTMLBody: "<p>" + randomText(t, 32*1024) + "</p>",
		}); err != nil {
			t.Fatalf("AddArticle() error = %v", err)
		}

		cancel()
		if err := packer.AddArticle(ctx, domain.KindleArticle{
			ID:       "canceled-2",
			Title:    "第二篇",
			HTMLBody: "<p>hello</p>",
		}); !errors.Is(err, context.Canceled) {
			t.Fatalf("AddArticle(canceled) error = %v, want context.Canceled", err)
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after cancel: %v", remaining)
		}
	})
}

func TestPackerEnforcesPerJobSpoolQuota(t *testing.T) {
	t.Parallel()

	spoolDir := t.TempDir()
	packer, err := newTestBuilder(Config{
		MaxEPUBBytes:     128 * 1024,
		MaxJobSpoolBytes: 150 * 1024,
		SpoolDir:         spoolDir,
	}).NewPacker(context.Background(), "2026-03-15", domain.KindleLanguageChinese)
	if err != nil {
		t.Fatalf("NewPacker() error = %v", err)
	}

	var quotaErr error
	for i := range 4 {
		err := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       fmt.Sprintf("a-%d", i+1),
			Title:    fmt.Sprintf("文章 %d", i+1),
			HTMLBody: "<p>" + randomText(t, 80*1024) + "</p>",
		})
		if err != nil {
			quotaErr = err
			break
		}
	}

	if quotaErr == nil || !strings.Contains(quotaErr.Error(), "spool quota exceeded") {
		t.Fatalf("expected spool quota error, got %v", quotaErr)
	}

	if err := packer.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	remaining, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("leftover spool files after quota failure: %v", remaining)
	}
}

func TestPrepareSpoolDirCleansLeftoversAndEnforces0700(t *testing.T) {
	t.Parallel()

	parent := t.TempDir()
	spoolDir := filepath.Join(parent, "spool")
	if err := os.MkdirAll(filepath.Join(spoolDir, "nested"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "stale.spool"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "nested", "inner.spool"), []byte("inner"), 0o600); err != nil {
		t.Fatalf("WriteFile(nested) error = %v", err)
	}

	if err := PrepareSpoolDir(spoolDir); err != nil {
		t.Fatalf("PrepareSpoolDir() error = %v", err)
	}

	info, err := os.Stat(spoolDir)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		t.Fatalf("spool dir mode = %o, want 0700", perm)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected clean spool dir, got %v", entries)
	}
}

func TestPackerRetriesSpoolRemovalOnCloseAfterReadBookFailure(t *testing.T) {
	t.Parallel()

	spoolDir := t.TempDir()
	rawPacker, err := newTestBuilder(Config{SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15", domain.KindleLanguageChinese)
	if err != nil {
		t.Fatalf("NewPacker() error = %v", err)
	}

	p := rawPacker.(*packer)
	defer func() {
		p.removeFile = os.Remove
		_ = p.Close()
	}()

	if err := p.AddArticle(context.Background(), domain.KindleArticle{
		ID:       "a-1",
		Title:    "文章 1",
		HTMLBody: "<p>hello</p>",
	}); err != nil {
		t.Fatalf("AddArticle() error = %v", err)
	}

	if _, err := p.Finish(context.Background()); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}

	p.removeFile = func(string) error {
		return errors.New("transient remove failure")
	}

	if _, err := p.ReadBook(context.Background(), 0); err == nil {
		t.Fatal("expected ReadBook() error when spool removal fails")
	}

	if _, err := p.ReadBook(context.Background(), 0); err == nil || !strings.Contains(err.Error(), "already consumed") {
		t.Fatalf("expected consumed error on second ReadBook(), got %v", err)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("spool files after failed ReadBook remove = %d, want 1 retained for Close retry", len(entries))
	}

	p.removeFile = os.Remove
	if err := p.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	entries, err = os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() after Close error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("leftover spool files after Close retry: %v", entries)
	}
}

func TestPrepareSpoolDirDoesNotFollowSymlinks(t *testing.T) {
	t.Parallel()

	baseDir := t.TempDir()
	outsideDir := filepath.Join(baseDir, "outside")
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(outside) error = %v", err)
	}

	keepPath := filepath.Join(outsideDir, "keep.txt")
	if err := os.WriteFile(keepPath, []byte("do not delete"), 0o600); err != nil {
		t.Fatalf("WriteFile(keep) error = %v", err)
	}

	spoolDir := filepath.Join(baseDir, "spool")
	if err := os.MkdirAll(filepath.Join(spoolDir, "nested"), 0o700); err != nil {
		t.Fatalf("MkdirAll(spool) error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "stale.spool"), []byte("stale"), 0o600); err != nil {
		t.Fatalf("WriteFile(stale) error = %v", err)
	}

	if err := os.Symlink(outsideDir, filepath.Join(spoolDir, "top-link")); err != nil {
		t.Fatalf("Symlink(top-link) error = %v", err)
	}

	if err := os.Symlink(outsideDir, filepath.Join(spoolDir, "nested", "nested-link")); err != nil {
		t.Fatalf("Symlink(nested-link) error = %v", err)
	}

	if err := PrepareSpoolDir(spoolDir); err != nil {
		t.Fatalf("PrepareSpoolDir(spoolDir) error = %v", err)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir(spoolDir) error = %v", err)
	}

	if len(entries) != 0 {
		t.Fatalf("expected empty spoolDir after cleanup, got %v", entries)
	}

	gotKeep, err := os.ReadFile(keepPath)
	if err != nil {
		t.Fatalf("ReadFile(keep) after cleanup error = %v", err)
	}

	if string(gotKeep) != "do not delete" {
		t.Fatalf("keep.txt content = %q, want %q", string(gotKeep), "do not delete")
	}

	symlinkSpool := filepath.Join(baseDir, "spool-symlink")
	if err := os.Symlink(outsideDir, symlinkSpool); err != nil {
		t.Fatalf("Symlink(spool-symlink) error = %v", err)
	}

	if err := PrepareSpoolDir(symlinkSpool); err == nil {
		t.Fatal("expected PrepareSpoolDir(symlink) to fail")
	}

	if _, err := os.Stat(keepPath); err != nil {
		t.Fatalf("keep.txt missing after symlink spool attempt: %v", err)
	}
}
