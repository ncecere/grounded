package evals

import (
	"testing"
	"time"
)

func TestDailyAt(t *testing.T) {
	h := dailyAt(3)
	at := func(s string) string { return h.Next(mustTime(t, s)).Format("2006-01-02T15:04") }
	if got := at("2026-09-28T01:00:00Z"); got != "2026-09-28T03:00" {
		t.Errorf("before = %s", got)
	}
	if got := at("2026-09-28T03:00:00Z"); got != "2026-09-29T03:00" {
		t.Errorf("at = %s", got)
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
