package domain

import "testing"

func TestFormatKindleBookMeta(t *testing.T) {
	t.Parallel()

	title1, file1 := FormatKindleBookMeta("2026-11-18", 1, 1)
	if title1 != "Lantern 2026-11-18" || file1 != "lantern-2026-11-18.epub" {
		t.Fatalf("unexpected single book meta: %q, %q", title1, file1)
	}

	titleN, fileN := FormatKindleBookMeta("2026-11-18", 2, 3)
	if titleN != "Lantern 2026-11-18 (2/3)" || fileN != "lantern-2026-11-18-2.epub" {
		t.Fatalf("unexpected multi book meta: %q, %q", titleN, fileN)
	}

	titleManual, fileManual := FormatKindleBookMeta("", 1, 1)
	if titleManual != "Lantern" || fileManual != "lantern.epub" {
		t.Fatalf("unexpected undated single book meta: %q, %q", titleManual, fileManual)
	}

	titleManualN, fileManualN := FormatKindleBookMeta("", 2, 3)
	if titleManualN != "Lantern (2/3)" || fileManualN != "lantern-2.epub" {
		t.Fatalf("unexpected undated multi book meta: %q, %q", titleManualN, fileManualN)
	}
}
