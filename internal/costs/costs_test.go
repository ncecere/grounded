package costs

import (
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func rat(s string) *big.Rat {
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		panic(s)
	}
	return r
}

func day(s string) Day {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func TestParseAmount(t *testing.T) {
	for _, ok := range []string{"0", "12", "12.5", "0.000001", "99999999999999.999999", " 3.10 "} {
		if _, err := ParseAmount(ok, "budget"); err != nil {
			t.Errorf("ParseAmount(%q) = %v", ok, err)
		}
	}
	for _, bad := range []string{"", "-1", "1e3", "1.0000001", "abc", "1,5", "123456789012345", ".5", "NaN"} {
		if _, err := ParseAmount(bad, "budget"); err == nil {
			t.Errorf("ParseAmount(%q) accepted", bad)
		}
	}
	if got := Format(rat("12.5")); got != "12.500000" {
		t.Errorf("Format = %s", got)
	}
	if got := Format(rat("1/3")); got != "0.333333" {
		t.Errorf("Format(1/3) = %s", got)
	}
	if got := Format(rat("2/3")); got != "0.666667" {
		t.Errorf("Format(2/3) = %s", got)
	}
}

func TestCostArithmetic(t *testing.T) {
	cases := []struct {
		qty   int64
		unit  string
		price string
		want  string
	}{
		{1_000_000, UnitChatIn, "3", "3.000000"},
		{1, UnitChatOut, "15", "0.000015"},
		{1234, UnitEmbed, "0.02", "0.000025"}, // 0.00002468, rounded
		{250_000, UnitSystemOneTokens, "0.4", "0.100000"},
		{3, UnitSystemOneRequests, "0.002", "0.006000"},
		{7, UnitModeration, "0.001", "0.007000"},
		{0, UnitChatIn, "3", "0.000000"},
	}
	for _, c := range cases {
		if got := Format(Cost(c.qty, c.unit, rat(c.price))); got != c.want {
			t.Errorf("Cost(%d %s at %s) = %s, want %s", c.qty, c.unit, c.price, got, c.want)
		}
	}
	// Summing exact costs, not rounded ones: a thousand single tokens at 15 per
	// million are 0.015, where rounding each would give 0.015 too but a
	// float sum would drift.
	sum := new(big.Rat)
	for range 1000 {
		sum.Add(sum, Cost(1, UnitChatOut, rat("15")))
	}
	if Format(sum) != "0.015000" {
		t.Errorf("sum = %s", Format(sum))
	}
	if p := Percent(rat("80"), rat("100")); p == nil || *p != 80 {
		t.Errorf("Percent = %v", p)
	}
	if p := Percent(rat("99.999"), rat("100")); *p != 99 {
		t.Errorf("Percent rounds down, got %d", *p)
	}
	if Percent(rat("1"), rat("0")) != nil || Percent(rat("1"), nil) != nil {
		t.Error("Percent of no limit")
	}
}

func TestPriceBookEffectiveDating(t *testing.T) {
	m := uuid.New()
	other := uuid.New()
	book := NewPriceBook([]Price{
		{ModelID: m, Unit: UnitChatIn, Price: rat("3"), EffectiveFrom: day("2026-01-01")},
		{ModelID: m, Unit: UnitChatIn, Price: rat("2.5"), EffectiveFrom: day("2026-09-15")},
		{ModelID: m, Unit: UnitChatIn, Price: rat("4"), EffectiveFrom: day("2026-12-01")}, // scheduled
		{ModelID: m, Unit: UnitChatOut, Price: rat("15"), EffectiveFrom: day("2026-09-01")},
		{ModelID: other, Unit: UnitEmbed, Price: rat("0.02"), EffectiveFrom: day("2026-01-01")},
	})
	cases := []struct {
		unit, day, want string // want "" = unpriced
	}{
		{UnitChatIn, "2025-12-31", ""},
		{UnitChatIn, "2026-01-01", "3"},
		{UnitChatIn, "2026-09-14", "3"},
		{UnitChatIn, "2026-09-15", "2.5"},
		{UnitChatIn, "2026-11-30", "2.5"},
		{UnitChatIn, "2026-12-01", "4"},
		{UnitChatOut, "2026-08-31", ""},
		{UnitChatOut, "2026-09-01", "15"},
		{UnitEmbed, "2026-09-01", ""}, // another model's price
	}
	for _, c := range cases {
		p, ok := book.At(m, c.unit, day(c.day))
		switch {
		case c.want == "" && ok:
			t.Errorf("%s on %s priced at %s, want unpriced", c.unit, c.day, Format(p.Price))
		case c.want != "" && (!ok || p.Price.Cmp(rat(c.want)) != 0):
			t.Errorf("%s on %s = %v %v, want %s", c.unit, c.day, ok, p.Price, c.want)
		}
	}

	// Pricing usage: each day at its own price; unpriced usage counts zero
	// and is flagged.
	rows := []usageRow{
		{Day: day("2026-09-14"), Unit: UnitChatIn, Model: uuid.NullUUID{UUID: m, Valid: true}, Quantity: 1_000_000},
		{Day: day("2026-09-15"), Unit: UnitChatIn, Model: uuid.NullUUID{UUID: m, Valid: true}, Quantity: 1_000_000},
		{Day: day("2026-09-15"), Unit: UnitChatOut, Model: uuid.NullUUID{UUID: m, Valid: true}, Quantity: 100_000},
		{Day: day("2026-09-15"), Unit: UnitModeration, Model: uuid.NullUUID{UUID: other, Valid: true}, Quantity: 5},
	}
	got := Sum(book, rows, func(usageRow) string { return "all" })["all"]
	if Format(got.Spend) != "7.000000" || Format(got.ByCategory["chat"]) != "7.000000" {
		t.Errorf("spend = %s (chat %s), want 3 + 2.5 + 1.5 = 7", Format(got.Spend), Format(got.ByCategory["chat"]))
	}
	if !got.Unpriced || got.Tokens != 2_100_000 || got.Requests != 5 {
		t.Errorf("totals = %+v", got)
	}
}

func TestMonthBoundsInZones(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	kolkata, _ := time.LoadLocation("Asia/Kolkata")        // +05:30
	adelaide, _ := time.LoadLocation("Australia/Adelaide") // +09:30 / +10:30 (DST)
	cases := []struct {
		name       string
		at         string
		loc        *time.Location
		start, end string
		month      string
	}{
		{"UTC", "2026-09-28T12:00:00Z", time.UTC, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-09-01"},
		// 1 October 01:00 UTC is still 30 September in New York (EDT, -4).
		{"New York before local midnight", "2026-10-01T01:00:00Z", ny, "2026-09-01T04:00:00Z", "2026-10-01T04:00:00Z", "2026-09-01"},
		// November: the month starts in EDT (-4) and ends in EST (-5).
		{"New York across the DST change", "2026-11-15T12:00:00Z", ny, "2026-11-01T04:00:00Z", "2026-12-01T05:00:00Z", "2026-11-01"},
		// March: starts in EST, ends in EDT.
		{"New York spring forward", "2026-03-20T12:00:00Z", ny, "2026-03-01T05:00:00Z", "2026-04-01T04:00:00Z", "2026-03-01"},
		{"Kolkata", "2026-09-30T18:45:00Z", kolkata, "2026-09-30T18:30:00Z", "2026-10-31T18:30:00Z", "2026-10-01"},
		{"Kolkata just before", "2026-09-30T18:29:59Z", kolkata, "2026-08-31T18:30:00Z", "2026-09-30T18:30:00Z", "2026-09-01"},
		// Adelaide moves to +10:30 on 4 October 2026.
		{"Adelaide", "2026-10-15T00:00:00Z", adelaide, "2026-09-30T14:30:00Z", "2026-10-31T13:30:00Z", "2026-10-01"},
	}
	for _, c := range cases {
		at, _ := time.Parse(time.RFC3339, c.at)
		start, end, month := MonthBounds(at, c.loc)
		if start.UTC().Format(time.RFC3339) != c.start || end.UTC().Format(time.RFC3339) != c.end || month.Format(time.DateOnly) != c.month {
			t.Errorf("%s: MonthBounds = %s, %s, %s; want %s, %s, %s", c.name, start.UTC().Format(time.RFC3339), end.UTC().Format(time.RFC3339),
				month.Format(time.DateOnly), c.start, c.end, c.month)
		}
	}
}

func TestHourBucketsAtHalfHourBoundaries(t *testing.T) {
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	at, _ := time.Parse(time.RFC3339, "2026-10-10T00:00:00Z")
	start, end, _ := MonthBounds(at, kolkata) // 2026-09-30T18:30Z .. 2026-10-31T18:30Z
	lo, hi := HourRange(start, end)
	// The hour 18:00-19:00 UTC starts at 23:30 on 30 September local time, so
	// it counts in September: October's buckets start at 19:00 UTC.
	if lo.Format(time.RFC3339) != "2026-09-30T19:00:00Z" || hi.Format(time.RFC3339) != "2026-10-31T19:00:00Z" {
		t.Errorf("HourRange = %s .. %s", lo.Format(time.RFC3339), hi.Format(time.RFC3339))
	}
	// On whole-hour zones the buckets are the month exactly.
	lo, hi = HourRange(time.Date(2026, 9, 1, 4, 0, 0, 0, time.UTC), time.Date(2026, 10, 1, 4, 0, 0, 0, time.UTC))
	if lo.Hour() != 4 || hi.Hour() != 4 || lo.Day() != 1 {
		t.Errorf("whole-hour HourRange = %s .. %s", lo, hi)
	}
	// The hour's local day is where it starts.
	if d := DayOf(time.Date(2026, 9, 30, 18, 0, 0, 0, time.UTC), kolkata); d.Format(time.DateOnly) != "2026-09-30" {
		t.Errorf("DayOf = %s", d)
	}
	if d := DayOf(time.Date(2026, 9, 30, 19, 0, 0, 0, time.UTC), kolkata); d.Format(time.DateOnly) != "2026-10-01" {
		t.Errorf("DayOf = %s", d)
	}
}

func TestStatesAndProjection(t *testing.T) {
	if s := stateOf(rat("79.99"), rat("100"), 80); s != StateOK {
		t.Errorf("79.99 of 100 = %s", s)
	}
	if s := stateOf(rat("80"), rat("100"), 80); s != StateWarning {
		t.Errorf("80 of 100 = %s", s)
	}
	if s := stateOf(rat("100"), rat("100"), 80); s != StateExhausted {
		t.Errorf("100 of 100 = %s", s)
	}
	if s := stateOf(rat("0"), rat("0"), 80); s != StateExhausted {
		t.Errorf("a zero budget = %s", s)
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if p := Projected(rat("10"), start, end, start.Add(10*24*time.Hour)); Format(p) != "30.000000" {
		t.Errorf("projected = %s", Format(p))
	}
	if Projected(rat("10"), start, end, start.Add(time.Minute)) != nil {
		t.Error("projection in the first hour")
	}
	if EffectiveMode(ModeTrack, ModeInherit) != ModeTrack || EffectiveMode(ModeOff, ModeEnforce) != ModeEnforce {
		t.Error("EffectiveMode")
	}
	for _, bad := range []string{"", "Local", "Mars/Olympus"} {
		if _, err := LoadZone(bad); err == nil {
			t.Errorf("LoadZone(%q) accepted", bad)
		}
	}
	if UnitsFor("rerank") != nil || len(UnitsFor("systemone")) != 2 {
		t.Error("UnitsFor")
	}
}

func TestCSVColumnsAreUnique(t *testing.T) {
	team := ReportRow{Key: uuid.NewString(), Label: "QA Team", TeamSlug: "qa-team", TeamName: "QA Team", Totals: NewTotals()}
	agent := ReportRow{Key: uuid.NewString(), Label: "Helper", TeamSlug: "qa-team", TeamName: "QA Team", Totals: NewTotals()}
	model := ReportRow{Key: uuid.NewString(), Label: "Chat", ModelKind: "chat", Totals: NewTotals()}
	daily := ReportRow{Key: "2026-09-01", Label: "2026-09-01", Totals: NewTotals()}
	for _, c := range []struct {
		groupBy string
		row     ReportRow
		head    string
		first   string
	}{
		{ByTeam, team, "team_id,team_slug,team_name,currency,spend,", team.Key + ",qa-team,QA Team,USD,0.000000,"},
		{ByAgent, agent, "agent_id,agent_name,team_slug,team_name,currency,spend,", agent.Key + ",Helper,qa-team,QA Team,USD,"},
		{ByModel, model, "model_id,model_name,model_kind,currency,spend,", model.Key + ",Chat,chat,USD,"},
		{ByDay, daily, "day,currency,spend,chat,embedding,systemone,moderation,ocr,tokens,requests,unpriced", "2026-09-01,USD,0.000000,"},
	} {
		var b strings.Builder
		if err := WriteCSV(&b, Report{GroupBy: c.groupBy, Currency: "USD", Rows: []ReportRow{c.row}}); err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(b.String()), "\n")
		if len(lines) != 2 || !strings.HasPrefix(lines[0], c.head) || !strings.HasPrefix(lines[1], c.first) {
			t.Errorf("%s: %q", c.groupBy, lines)
		}
		seen := map[string]bool{}
		for _, h := range strings.Split(lines[0], ",") {
			if seen[h] {
				t.Errorf("%s: column %q twice", c.groupBy, h)
			}
			seen[h] = true
		}
		if n := len(strings.Split(lines[0], ",")); n != len(strings.Split(lines[1], ",")) {
			t.Errorf("%s: %d columns, row has %d", c.groupBy, n, len(strings.Split(lines[1], ",")))
		}
	}
}
