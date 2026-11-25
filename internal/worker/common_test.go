package worker

import (
	"bytes"
	"errors"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

func TestBoundedLogError(t *testing.T) {
	t.Parallel()

	if got := boundedLogError(nil); got != "" {
		t.Fatalf("boundedLogError(nil) = %q, want empty", got)
	}

	exact := strings.Repeat("a", maxLogErrorBytes)
	if got := boundedLogError(errors.New(exact)); got != exact {
		t.Fatalf("boundedLogError(exact) len = %d, want %d", len(got), maxLogErrorBytes)
	}

	cases := []struct {
		name string
		msg  string
	}{
		{name: "long ascii", msg: strings.Repeat("x", maxLogErrorBytes+100)},
		{name: "long 3-byte runes", msg: strings.Repeat("中", maxLogErrorBytes)},
		{name: "offset 1 before 3-byte runes", msg: "a" + strings.Repeat("中", maxLogErrorBytes)},
		{name: "offset 2 before 3-byte runes", msg: "ab" + strings.Repeat("中", maxLogErrorBytes)},
		{name: "long 4-byte runes", msg: strings.Repeat("😀", maxLogErrorBytes)},
		{name: "offset 1 before 4-byte runes", msg: "a" + strings.Repeat("😀", maxLogErrorBytes)},
		{name: "offset 2 before 4-byte runes", msg: "ab" + strings.Repeat("😀", maxLogErrorBytes)},
		{name: "offset 3 before 4-byte runes", msg: "abc" + strings.Repeat("😀", maxLogErrorBytes)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := boundedLogError(errors.New(tc.msg))
			if len(got) > maxLogErrorBytes {
				t.Fatalf("len(boundedLogError) = %d, want <= %d", len(got), maxLogErrorBytes)
			}

			if !utf8.ValidString(got) {
				t.Fatalf("boundedLogError produced invalid UTF-8: %q", got)
			}

			if !strings.HasSuffix(got, "...") {
				t.Fatalf("boundedLogError = %q, want ... suffix", got)
			}
		})
	}
}

type lockedWriter struct {
	mu  *sync.Mutex
	buf *bytes.Buffer
}

func (w *lockedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.buf.Write(p)
}
