//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAcquireDataDirLockExclusiveUntilReleased(t *testing.T) {
	t.Parallel()

	dataDir := filepath.Join(t.TempDir(), "nested-data")
	first, err := acquireDataDirLock(dataDir)
	if err != nil {
		t.Fatalf("first acquireDataDirLock() error = %v", err)
	}

	lockReleased := false
	defer func() {
		if !lockReleased {
			_ = first.Close()
		}
	}()

	info, err := os.Stat(filepath.Join(dataDir, lockFileName))
	if err != nil {
		t.Fatalf("Stat(lockFile) error = %v", err)
	}

	if perm := info.Mode().Perm(); perm != lockFileMode {
		t.Fatalf("lockFile mode = %o, want %o", perm, lockFileMode)
	}

	second, err := acquireDataDirLock(dataDir)
	if err == nil {
		_ = second.Close()
		t.Fatal("second acquireDataDirLock() succeeded while first lock was held")
	}

	if !strings.Contains(err.Error(), errDataDirInUse) {
		t.Fatalf("second acquireDataDirLock() error = %v, want %q", err, errDataDirInUse)
	}

	if err := first.Close(); err != nil {
		t.Fatalf("first.Close() error = %v", err)
	}

	lockReleased = true

	third, err := acquireDataDirLock(dataDir)
	if err != nil {
		t.Fatalf("third acquireDataDirLock() after release error = %v", err)
	}

	if err := third.Close(); err != nil {
		t.Fatalf("third.Close() error = %v", err)
	}
}
