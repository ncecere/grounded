package analytics

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestRange(t *testing.T) {
	from, to, err := Range(time.Time{}, day("2026-09-26"))
	if err != nil || !from.Equal(day("2026-08-28")) || !to.Equal(day("2026-09-26")) {
		t.Fatalf("default = %v %v %v", from, to, err)
	}
	// A time of day in another zone is reduced to its UTC day.
	est := time.FixedZone("EST", -5*3600)
	if _, to, _ := Range(day("2026-09-01"), time.Date(2026, 9, 26, 22, 0, 0, 0, est)); !to.Equal(day("2026-09-27")) {
		t.Fatalf("to = %v", to)
	}
	for _, c := range []struct{ from, to string }{{"2026-09-10", "2026-09-01"}, {"2025-09-01", "2026-09-26"}} {
		if _, _, err := Range(day(c.from), day(c.to)); err == nil || !strings.Contains(err.Error(), "invalid_range") {
			t.Errorf("%s..%s: %v", c.from, c.to, err)
		}
	}
	if _, _, err := Range(day("2025-09-25"), day("2026-09-26")); err != nil {
		t.Errorf("366 days: %v", err)
	}
}

func TestFillDaysAndShares(t *testing.T) {
	events := []Day{{Date: day("2026-09-02").In(time.FixedZone("X", 3600)), Answers: 5, Refused: 1, Blocked: 2}}
	convs := []Day{{Date: day("2026-09-02"), Conversations: 3}, {Date: day("2026-09-01"), Conversations: 1}, {Date: day("2026-09-09"), Conversations: 9}}
	days := fillDays(day("2026-09-01"), day("2026-09-04"), events, convs)
	if len(days) != 3 || days[0].Conversations != 1 || days[1].Answers != 5 || days[1].Conversations != 3 || days[1].Blocked != 2 || days[2] != (Day{Date: day("2026-09-03")}) {
		t.Fatalf("days = %+v", days)
	}
	sh := sharesOf(map[string]int64{"widget": 1, "ui": 3, "api": 1}, 5)
	if len(sh) != 3 || sh[0].Key != "ui" || sh[0].Share != 0.6 || sh[1].Key != "api" || sh[2].Key != "widget" {
		t.Fatalf("shares = %+v", sh)
	}
	if sh := sharesOf(map[string]int64{}, 0); len(sh) != 0 || sh == nil {
		t.Fatalf("empty shares = %#v", sh)
	}
}

func TestWriteDailyCSV(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteDailyCSV(&buf, []Day{{Date: day("2026-09-01"), Answers: 12, Conversations: 4, NoContext: 1, Refused: 2, Blocked: 3, Flagged: 4}, {Date: day("2026-09-02")}}); err != nil {
		t.Fatal(err)
	}
	want := "date,answers,conversations,no_context,refused,moderation_blocked,moderation_flagged\n2026-09-01,12,4,1,2,3,4\n2026-09-02,0,0,0,0,0,0\n"
	if buf.String() != want {
		t.Fatalf("csv =\n%s", buf.String())
	}
}
