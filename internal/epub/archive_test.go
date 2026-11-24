package epub

import (
	"context"
	"encoding/xml"
	"reader/internal/domain"
	"testing"
)

type opfPackageDoc struct {
	Manifest struct {
		Items []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			MediaType  string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"item"`
	} `xml:"manifest"`
}

func TestOPFRemoteResourcesProperty(t *testing.T) {
	t.Parallel()

	pngData := encodeTestPNG(t, 8, 8)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/ok.png": {data: pngData, mediaType: "image/png"},
	})

	articles := []domain.KindleArticle{
		{
			ID:       "remote-video-and-srcset",
			URL:      "https://example.com/posts/1",
			Title:    "含远程资源",
			HTMLBody: `<video poster="https://example.com/poster.jpg"></video><img src="https://example.com/ok.png" srcset="https://example.com/ok-2x.png 2x"/>`,
		},
		{
			ID:       "local-and-links-only",
			URL:      "https://example.com/posts/2",
			Title:    "仅本地图片与外链",
			HTMLBody: `<p><a href="https://example.com/ext">外链</a></p><img src="https://example.com/ok.png"/><img src="https://example.com/missing.png"/>`,
		},
		{
			ID:       "protocol-relative-link",
			URL:      "https://example.com/posts/3",
			Title:    "协议相对资源",
			HTMLBody: `<link href="//cdn.example.com/style.css"/><audio src="https://example.com/a.mp3"></audio><object data="https://example.com/app"></object>`,
		},
	}

	books, err := NewBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	reader := openArchive(t, books[0].Data)
	opfBytes := entryBody(t, entryByName(t, reader, "OEBPS/content.opf"))
	requireValidXML(t, "OEBPS/content.opf", opfBytes)

	var opf opfPackageDoc
	if err := xml.Unmarshal(opfBytes, &opf); err != nil {
		t.Fatalf("xml.Unmarshal(content.opf) error = %v", err)
	}

	propsByID := make(map[string]string, len(opf.Manifest.Items))
	for _, item := range opf.Manifest.Items {
		propsByID[item.ID] = item.Properties
	}

	wantProps := map[string]string{
		"chapter-0001": "remote-resources",
		"chapter-0002": "",
		"chapter-0003": "remote-resources",
	}
	for id, want := range wantProps {
		got, ok := propsByID[id]
		if !ok {
			t.Fatalf("content.opf missing manifest item %q:\n%s", id, string(opfBytes))
		}

		if got != want {
			t.Fatalf("manifest item %q properties = %q, want %q\n%s", id, got, want, string(opfBytes))
		}
	}
}

func TestArchiveEntriesUseZipReaderVersion20(t *testing.T) {
	t.Parallel()

	pngData := encodeTestPNG(t, 12, 12)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/a.png": {data: pngData, mediaType: "image/png"},
	})

	books, err := NewBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{
		{
			ID:       "a-1",
			URL:      "https://example.com/posts/1",
			Title:    "版本检查",
			HTMLBody: `<p>hello</p><img src="https://example.com/a.png"/>`,
		},
	})
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	reader := openArchive(t, books[0].Data)
	if len(reader.File) == 0 {
		t.Fatal("expected non-empty zip entries")
	}

	entryByName(t, reader, "OEBPS/images/img-0001.png")
	for _, file := range reader.File {
		if file.ReaderVersion != 20 {
			t.Fatalf("entry %q ReaderVersion = %d, want 20", file.Name, file.ReaderVersion)
		}
	}
}
