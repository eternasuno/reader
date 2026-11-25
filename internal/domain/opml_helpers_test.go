package domain

import (
	"errors"
	"testing"
)

func opmlTestURL(raw string) NormalizedURL {
	feedURL, err := ParseNormalizedURL(raw, ErrFeedUrlInvalid)
	if err != nil {
		panic(err)
	}

	return feedURL
}

func opmlTestFeed(t *testing.T, id string, title string, rawURL string) Feed {
	t.Helper()

	return Feed{ID: id, Title: title, URL: opmlTestURL(rawURL)}
}

func opmlTestFolderName(feed OPMLFeedInput) string {
	if feed.FolderName == nil {
		return "<top>"
	}

	return *feed.FolderName
}

func opmlTestErrorCode(t *testing.T, err error) ErrorCode {
	t.Helper()

	if err == nil {
		t.Fatalf("expected an error, got nil")
	}

	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("error %v is not a *DomainError", err)
	}

	return domainErr.Code
}
