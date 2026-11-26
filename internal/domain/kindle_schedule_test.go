package domain

import (
	"testing"
	"time"
)

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()

	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load timezone %s: %v", name, err)
	}

	return loc
}

func utcTime(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
}

func requireUTCTime(t *testing.T, got, want time.Time) {
	t.Helper()

	if !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("got %s (%s), want %s UTC", got, got.Location(), want)
	}
}

var (
	at0800      = KindleSchedule{Hour: 8, Minute: 0}
	at0805      = KindleSchedule{Hour: 8, Minute: 5}
	at0000      = KindleSchedule{Hour: 0, Minute: 0}
	at2330      = KindleSchedule{Hour: 23, Minute: 30}
	at0230      = KindleSchedule{Hour: 2, Minute: 30}
	at0300      = KindleSchedule{Hour: 3, Minute: 0}
	at0930      = KindleSchedule{Hour: 9, Minute: 30}
	at0130      = KindleSchedule{Hour: 1, Minute: 30}
	newYork     = "America/New_York"
	utcZone     = "UTC"
	noAnchor    = time.Time{}
	previousRun = utcTime(2026, time.February, 28, 8, 0)
)

func TestLoadKindleLocation(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"UTC", "America/New_York", "Asia/Shanghai"} {
		loc, err := LoadKindleLocation(name)
		if err != nil {
			t.Fatalf("timezone %q should load: %v", name, err)
		}

		if loc.String() != name {
			t.Fatalf("location = %q, want %q", loc, name)
		}
	}

	for _, name := range []string{"", "Local", "Mars/Olympus", " UTC"} {
		_, err := LoadKindleLocation(name)
		requireDomainError(t, err, ErrInvalidKindleSetting)
	}
}

func TestNextKindleOccurrence(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		schedule KindleSchedule
		zone     string
		after    time.Time
		want     time.Time
	}{
		{"same day later", at0800, utcZone, utcTime(2026, 3, 1, 7, 0), utcTime(2026, 3, 1, 8, 0)},
		{"strictly after an exact occurrence", at0800, utcZone, utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 2, 8, 0)},
		{"next day once today's passed", at0800, utcZone, utcTime(2026, 3, 1, 8, 1), utcTime(2026, 3, 2, 8, 0)},
		{"year rollover", at0000, utcZone, utcTime(2026, 12, 31, 23, 59), utcTime(2027, 1, 1, 0, 0)},
		{"non-zero minute", at0805, utcZone, utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 1, 8, 5)},
		{"standard time offset", at0800, newYork, utcTime(2026, 1, 15, 12, 0), utcTime(2026, 1, 15, 13, 0)},
		{"daylight time offset", at0800, newYork, utcTime(2026, 7, 15, 11, 0), utcTime(2026, 7, 15, 12, 0)},
		{"local date ahead of UTC date", at2330, newYork, utcTime(2026, 1, 16, 3, 0), utcTime(2026, 1, 16, 4, 30)},
		{"spring gap skips the day", at0230, newYork, utcTime(2026, 3, 8, 6, 0), utcTime(2026, 3, 9, 6, 30)},
		{"spring gap skipped after previous run", at0230, newYork, utcTime(2026, 3, 7, 7, 30), utcTime(2026, 3, 9, 6, 30)},
		{"spring gap end exists", at0300, newYork, utcTime(2026, 3, 8, 6, 0), utcTime(2026, 3, 8, 7, 0)},
		{"spring day after the gap", at0930, newYork, utcTime(2026, 3, 8, 6, 0), utcTime(2026, 3, 8, 13, 30)},
		{"fall first occurrence", at0130, newYork, utcTime(2026, 11, 1, 5, 0), utcTime(2026, 11, 1, 5, 30)},
		{"fall second occurrence", at0130, newYork, utcTime(2026, 11, 1, 5, 45), utcTime(2026, 11, 1, 6, 30)},
		{"fall after both occurrences", at0130, newYork, utcTime(2026, 11, 1, 6, 30), utcTime(2026, 11, 2, 6, 30)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := NextKindleOccurrence(tc.schedule, mustLoadLocation(t, tc.zone), tc.after)
			requireUTCTime(t, got, tc.want)
		})
	}
}

func TestLatestKindleOccurrence(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		schedule KindleSchedule
		zone     string
		now      time.Time
		want     time.Time
	}{
		{"inclusive of now", at0800, utcZone, utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 1, 8, 0)},
		{"today's occurrence passed", at0800, utcZone, utcTime(2026, 3, 1, 20, 0), utcTime(2026, 3, 1, 8, 0)},
		{"yesterday's before today's", at0800, utcZone, utcTime(2026, 3, 1, 7, 59), utcTime(2026, 2, 28, 8, 0)},
		{"local date behind UTC date", at2330, newYork, utcTime(2026, 1, 16, 3, 0), utcTime(2026, 1, 15, 4, 30)},
		{"spring gap day has none", at0230, newYork, utcTime(2026, 3, 8, 12, 0), utcTime(2026, 3, 7, 7, 30)},
		{"fall before first occurrence", at0130, newYork, utcTime(2026, 11, 1, 5, 15), utcTime(2026, 10, 31, 5, 30)},
		{"fall between occurrences", at0130, newYork, utcTime(2026, 11, 1, 5, 45), utcTime(2026, 11, 1, 5, 30)},
		{"fall after both occurrences", at0130, newYork, utcTime(2026, 11, 1, 6, 45), utcTime(2026, 11, 1, 6, 30)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := LatestKindleOccurrence(tc.schedule, mustLoadLocation(t, tc.zone), tc.now)
			requireUTCTime(t, got, tc.want)
		})
	}
}

func localTime(loc *time.Location, year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, loc)
}

// Pacific/Apia crossed the date line at the end of 2011-12-29 and has no
// 2011-12-30, so a scan stepping local noon by whole days never leaves it.
func TestKindleOccurrencesSkipRemovedCivilDate(t *testing.T) {
	t.Parallel()

	apia := mustLoadLocation(t, "Pacific/Apia")
	beforeGap := localTime(apia, 2011, time.December, 29, 8, 0)
	afterGap := localTime(apia, 2011, time.December, 31, 8, 0)

	t.Run("latest goes back past the removed date", func(t *testing.T) {
		t.Parallel()

		got := LatestKindleOccurrence(at0800, apia, localTime(apia, 2011, time.December, 31, 7, 0))
		requireUTCTime(t, got, beforeGap.UTC())
	})

	t.Run("next goes forward past the removed date", func(t *testing.T) {
		t.Parallel()

		got := NextKindleOccurrence(at0800, apia, localTime(apia, 2011, time.December, 29, 9, 0))
		requireUTCTime(t, got, afterGap.UTC())
	})
}

func TestDueKindleOccurrence(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		schedule KindleSchedule
		zone     string
		now      time.Time
		anchor   time.Time
		wantAt   time.Time
		wantDue  bool
	}{
		{"anchor before occurrence", at0800, utcZone, utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 1, 7, 59), utcTime(2026, 3, 1, 8, 0), true},
		{"anchor equal to occurrence", at0800, utcZone, utcTime(2026, 3, 1, 8, 10), utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 1, 8, 0), false},
		{"schedule saved after occurrence", at0800, utcZone, utcTime(2026, 3, 1, 8, 10), utcTime(2026, 3, 1, 8, 3), utcTime(2026, 3, 1, 8, 0), false},
		{"yesterday's occurrence already handled", at0800, utcZone, utcTime(2026, 3, 1, 7, 0), previousRun, previousRun, false},
		{"missed during downtime fires only the latest", at0800, utcZone, utcTime(2026, 3, 1, 9, 0), utcTime(2026, 2, 25, 8, 0), utcTime(2026, 3, 1, 8, 0), true},
		{"no history is due", at0800, utcZone, utcTime(2026, 3, 1, 9, 0), noAnchor, utcTime(2026, 3, 1, 8, 0), true},
		{"fall first occurrence handled", at0130, newYork, utcTime(2026, 11, 1, 6, 0), utcTime(2026, 11, 1, 5, 30), utcTime(2026, 11, 1, 5, 30), false},
		{"fall second occurrence due", at0130, newYork, utcTime(2026, 11, 1, 6, 30), utcTime(2026, 11, 1, 5, 30), utcTime(2026, 11, 1, 6, 30), true},
		{"spring gap day is never due", at0230, newYork, utcTime(2026, 3, 8, 12, 0), utcTime(2026, 3, 7, 7, 30), utcTime(2026, 3, 7, 7, 30), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			gotAt, gotDue := DueKindleOccurrence(tc.schedule, mustLoadLocation(t, tc.zone), tc.now, tc.anchor)
			requireUTCTime(t, gotAt, tc.wantAt)

			if gotDue != tc.wantDue {
				t.Fatalf("due = %v, want %v", gotDue, tc.wantDue)
			}
		})
	}
}

func TestKindleNextSendAt(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		schedule KindleSchedule
		zone     string
		now      time.Time
		anchor   time.Time
		want     time.Time
	}{
		{"due occurrence is shown", at0800, utcZone, utcTime(2026, 3, 1, 9, 0), previousRun, utcTime(2026, 3, 1, 8, 0)},
		{"handled occurrence shows the next", at0800, utcZone, utcTime(2026, 3, 1, 9, 0), utcTime(2026, 3, 1, 8, 0), utcTime(2026, 3, 2, 8, 0)},
		{"spring gap day shows the next valid day", at0230, newYork, utcTime(2026, 3, 8, 12, 0), utcTime(2026, 3, 7, 7, 30), utcTime(2026, 3, 9, 6, 30)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := KindleNextSendAt(tc.schedule, mustLoadLocation(t, tc.zone), tc.now, tc.anchor)
			requireUTCTime(t, got, tc.want)
		})
	}
}
