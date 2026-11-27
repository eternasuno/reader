package fetcher

import (
	"errors"
	"reader/internal/domain"
	"testing"
)

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
