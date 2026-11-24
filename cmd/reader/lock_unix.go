//go:build unix

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

const (
	dataDirMode     = 0o700
	lockFileMode    = 0o600
	lockFileName    = "lantern.lock"
	errDataDirInUse = "another Lantern instance is already using DATA_DIR"
)

// acquireDataDirLock opens <dataDir>/lantern.lock and acquires an exclusive,
// non-blocking advisory flock until the returned file is closed.
func acquireDataDirLock(dataDir string) (*os.File, error) {
	if err := os.MkdirAll(dataDir, dataDirMode); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	lockPath := filepath.Join(dataDir, lockFileName)
	//nolint:gosec // lockPath is constructed from the operator-configured DATA_DIR.
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, lockFileMode)
	if err != nil {
		return nil, fmt.Errorf("open data directory lock: %w", err)
	}

	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, errors.New(errDataDirInUse)
		}

		return nil, fmt.Errorf("lock data directory: %w", err)
	}

	return file, nil
}
