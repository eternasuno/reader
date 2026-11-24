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
}

func TestIsKindleDeliveryUsableAndClone(t *testing.T) {
	t.Parallel()

	user := "user"
	pass := "pass"
	settings := Settings{
		SMTP: &SMTPSettings{
			SenderEmail: "sender@example.com",
			Host:        "smtp.example.com",
			Port:        587,
			Security:    SMTPSecuritySTARTTLS,
			User:        &user,
			Password:    &pass,
		},
		Kindle: &KindleSettings{KindleEmail: "reader@kindle.com"},
	}

	if !IsKindleDeliveryUsable(settings) {
		t.Fatal("expected valid settings to be usable")
	}

	cloned := CloneKindleDelivery(*settings.SMTP, settings.Kindle.KindleEmail)
	*settings.SMTP.User = "mutated"
	*settings.SMTP.Password = "mutated"

	if *cloned.SMTP.User != "user" || *cloned.SMTP.Password != "pass" {
		t.Fatalf("cloned pointers mutated: %+v", cloned)
	}

	settings.Kindle.KindleEmail = "  "
	if IsKindleDeliveryUsable(settings) {
		t.Fatal("expected blank kindle email to be unusable")
	}
}
