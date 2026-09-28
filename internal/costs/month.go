package costs

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/apperr"
)

// Calendar math in the platform time zone (docs/costs.md §3 and §4). The
// budget month and report days are local; usage is rolled up by UTC hour. A
// usage hour belongs to the local day (and month) in which it starts, so in
// zones with a :30 or :45 offset the hour a boundary falls inside counts on
// the side where it starts.

// Day is a local calendar date, held as midnight UTC of that date.
type Day = time.Time

// DayOf is t's local date in loc.
func DayOf(t time.Time, loc *time.Location) Day {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// MonthOf is the first day of t's local month in loc.
func MonthOf(t time.Time, loc *time.Location) Day {
	y, m, _ := t.In(loc).Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC)
}

// StartOf is the instant a local day begins in loc (local midnight, or the
// first instant after it when a DST change skips midnight).
func StartOf(d Day, loc *time.Location) time.Time {
	y, m, dd := d.Date()
	return time.Date(y, m, dd, 0, 0, 0, 0, loc)
}

// MonthBounds are the instants the local month of t begins and ends
// ([start, end)), and the month's first day.
func MonthBounds(t time.Time, loc *time.Location) (start, end time.Time, month Day) {
	month = MonthOf(t, loc)
	return StartOf(month, loc), StartOf(month.AddDate(0, 1, 0), loc), month
}

// HourRange is the UTC hour buckets whose start lies in [from, to): those
// starting at or after ceil(from) and before ceil(to).
func HourRange(from, to time.Time) (lo, hi time.Time) { return ceilHour(from), ceilHour(to) }

func ceilHour(t time.Time) time.Time {
	h := t.UTC().Truncate(time.Hour)
	if h.Before(t) {
		h = h.Add(time.Hour)
	}
	return h
}

// LoadZone validates an IANA time zone name.
func LoadZone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, apperr.Invalid("invalid_time_zone", "Choose a time zone by its IANA name, such as UTC or America/New_York")
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, apperr.Invalid("invalid_time_zone", "Unknown time zone: "+name+". Use an IANA name, such as UTC or America/New_York")
	}
	return loc, nil
}

// zone loads a stored zone, falling back to UTC for a name this build's
// time zone database doesn't know.
func zone(name string) *time.Location {
	loc, err := LoadZone(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func pgDate(d Day) pgtype.Date { return pgtype.Date{Time: d, Valid: true} }

// ParseDay reads a date (YYYY-MM-DD).
func ParseDay(s, field string) (Day, error) {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return Day{}, apperr.Invalid("invalid_date", "The "+field+" must be a date (YYYY-MM-DD)")
	}
	return d, nil
}
