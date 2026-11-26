package sqlite

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestExportToWritesRestorableSnapshot(t *testing.T) {
	store := newTestStore(t)
	createFeed(t, store, "Exported", nil)

	var buf bytes.Buffer
	if err := store.ExportTo(context.Background(), &buf); err != nil {
		t.Fatalf("ExportTo: %v", err)
	}

	path := filepath.Join(t.TempDir(), "copy.db")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write copy: %v", err)
	}

	copied, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open copy: %v", err)
	}

	defer func() { _ = copied.Close() }()

	var count int
	if err := copied.ReadDB().QueryRowContext(context.Background(), `SELECT COUNT(*) FROM feed WHERE title = 'Exported'`).Scan(&count); err != nil {
		t.Fatalf("query copy: %v", err)
	}

	if count != 1 {
		t.Fatalf("feed count = %d, want 1", count)
	}

	entries, err := os.ReadDir(filepath.Dir(store.path))
	if err != nil {
		t.Fatalf("read data dir: %v", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			t.Fatalf("export left directory %q behind", entry.Name())
		}
	}
}
