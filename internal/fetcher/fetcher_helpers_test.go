package fetcher

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"reader/internal/domain"
	"testing"
)

func stubSettings(settings ExtractorSettings, err error) SettingsQuery {
	return func(ctx context.Context) (ExtractorSettings, error) {
		return settings, err
	}
}

func ptr(value string) *string {
	return &value
}

func mustNormalizedURL(t *testing.T, raw string) domain.NormalizedURL {
	t.Helper()

	parsed, err := domain.ParseNormalizedURL(raw, domain.ErrFeedUrlInvalid)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}

	return parsed
}

func requireDomainCode(t *testing.T, err error, code domain.ErrorCode) *domain.DomainError {
	t.Helper()

	if err == nil {
		t.Fatalf("expected %s error, got nil", code)
	}

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected domain error %s, got %T: %v", code, err, err)
	}

	if domainErr.Code != code {
		t.Fatalf("expected code %s, got %s: %v", code, domainErr.Code, err)
	}

	return domainErr
}
func readWSFrame(r *bufio.Reader) ([]byte, bool) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, false
	}

	opcode := header[0] & 0x0f
	if opcode == 8 {
		return nil, false
	}

	masked := header[1]&0x80 != 0
	length := int(header[1] & 0x7f)

	switch length {
	case 126:
		ext := make([]byte, 2)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, false
		}
		length = int(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err := io.ReadFull(r, ext); err != nil {
			return nil, false
		}
		length = int(binary.BigEndian.Uint64(ext))
	}

	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(r, mask[:]); err != nil {
			return nil, false
		}
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, false
	}

	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}

	return payload, true
}

func writeWSFrame(w *bufio.Writer, payload []byte) bool {
	if len(payload) < 126 {
		_ = w.WriteByte(0x81)
		_ = w.WriteByte(byte(len(payload)))
	} else {
		_ = w.WriteByte(0x81)
		_ = w.WriteByte(126)
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(len(payload)))
		_, _ = w.Write(ext[:])
	}

	_, err := w.Write(payload)
	if err != nil {
		return false
	}

	return w.Flush() == nil
}
