package domain

import (
	"slices"
	"time"
)

func LoadKindleLocation(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, NewError(ErrInvalidKindleSetting, nil)
	}

	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, NewError(ErrInvalidKindleSetting, err)
	}

	return loc, nil
}

// NextKindleOccurrence and LatestKindleOccurrence scan whole civil dates without
// a bound: a date lacks an occurrence only when a zone transition removes that
// local time (or, rarely, the whole date), so the scans end within two dates.
func NextKindleOccurrence(s KindleSchedule, loc *time.Location, after time.Time) time.Time {
	for day := civilDate(after, loc); ; day = day.AddDate(0, 0, 1) {
		for _, occurrence := range kindleOccurrencesOn(s, loc, day) {
			if occurrence.After(after) {
				return occurrence
			}
		}
	}
}

func LatestKindleOccurrence(s KindleSchedule, loc *time.Location, now time.Time) time.Time {
	for day := civilDate(now, loc); ; day = day.AddDate(0, 0, -1) {
		for _, occurrence := range slices.Backward(kindleOccurrencesOn(s, loc, day)) {
			if !occurrence.After(now) {
				return occurrence
			}
		}
	}
}

// civilDate returns t's date in loc as a UTC midnight cursor. Stepping it with
// AddDate never skips or repeats a date, which stepping a time in loc does when
// the zone removes a whole date.
func civilDate(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)

	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}

// kindleOccurrencesOn returns, in ascending UTC order, every instant at which
// the local wall clock of the civil date day reads the schedule time: none when
// a spring-forward gap skips it, two when a fall-back overlap repeats it.
func kindleOccurrencesOn(s KindleSchedule, loc *time.Location, day time.Time) []time.Time {
	base := time.Date(day.Year(), day.Month(), day.Day(), s.Hour, s.Minute, 0, 0, loc)

	var occurrences []time.Time
	for _, delta := range occurrenceDeltas(dstShift(base)) {
		candidate := base.Add(delta).In(loc)
		if isScheduledLocalTime(candidate, day, s) {
			occurrences = append(occurrences, candidate.UTC())
		}
	}

	return occurrences
}

// time.Date resolves a nonexistent or ambiguous local time to an unspecified
// one of the nearby instants, so probe one DST shift either side of it.
func occurrenceDeltas(shift time.Duration) []time.Duration {
	if shift <= 0 {
		return []time.Duration{0}
	}

	return []time.Duration{-shift, 0, shift}
}

func dstShift(base time.Time) time.Duration {
	_, beforeOff := base.Add(-3 * time.Hour).Zone()
	_, afterOff := base.Add(3 * time.Hour).Zone()
	shift := time.Duration(beforeOff-afterOff) * time.Second
	if shift < 0 {
		return -shift
	}

	return shift
}

func isScheduledLocalTime(candidate time.Time, day time.Time, s KindleSchedule) bool {
	if candidate.Year() != day.Year() || candidate.Month() != day.Month() || candidate.Day() != day.Day() {
		return false
	}

	return candidate.Hour() == s.Hour && candidate.Minute() == s.Minute
}
