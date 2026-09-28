package limits

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestRegistry(t *testing.T) {
	seen := map[Key]bool{}
	for _, d := range Defs() {
		if seen[d.Key] {
			t.Errorf("duplicate key %s", d.Key)
		}
		seen[d.Key] = true
		if d.Label == "" || d.Noun == "" || d.Description == "" || d.Group == "" || d.Unit == "" {
			t.Errorf("%s: incomplete definition %+v", d.Key, d)
		}
		if d.Default == nil || *d.Default <= 0 {
			t.Errorf("%s: built-in default should be a positive number", d.Key)
		}
	}
	if len(seen) != 23 {
		t.Errorf("%d keys", len(seen))
	}
	if _, ok := Lookup("nope"); ok {
		t.Error("unknown key found")
	}
}

func n(v int64) *int64 { return &v }

func TestEffective(t *testing.T) {
	p := Platform{Settings: map[Key]Setting{
		Documents:        {Default: n(100), Ceiling: n(500)},
		DataSources:      {Default: nil},                 // unlimited
		KnowledgeBases:   {Default: n(10)},               // no ceiling
		QueriesPerMinute: {Default: nil, Ceiling: n(50)}, // stored before validation: capped
	}}
	cases := []struct {
		key  Key
		o    Overrides
		want *int64
	}{
		{Documents, nil, n(100)},                       // inherit
		{Documents, Overrides{Documents: 300}, n(300)}, // override
		{Documents, Overrides{Documents: 900}, n(500)}, // capped by the ceiling
		{Documents, Overrides{Documents: 0}, n(0)},     // blocked
		{DataSources, nil, nil},                        // unlimited default
		{DataSources, Overrides{DataSources: 7}, n(7)}, // override of unlimited
		{KnowledgeBases, Overrides{KnowledgeBases: 1e9}, n(1e9)},
		{QueriesPerMinute, nil, n(50)},
	}
	for _, c := range cases {
		got := p.Effective(c.key, c.o)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s %v: got %v want %v", c.key, c.o, deref(got), deref(c.want))
		}
	}
}

func deref(p *int64) any {
	if p == nil {
		return "unlimited"
	}
	return *p
}

func TestParse(t *testing.T) {
	builtins := map[Key]*int64{}
	for _, d := range registry {
		builtins[d.Key] = d.Default
	}
	settings, custom, err := parsePlatform(json.RawMessage(`{"documents":{"default":null,"ceiling":null},"storage_bytes":{"default":5,"ceiling":9},"gone":{"default":1}}`), builtins)
	if err != nil {
		t.Fatal(err)
	}
	if settings[Documents].Default != nil || !custom[Documents] {
		t.Errorf("explicit null default = %+v", settings[Documents])
	}
	if *settings[StorageBytes].Default != 5 || *settings[StorageBytes].Ceiling != 9 {
		t.Errorf("storage = %+v", settings[StorageBytes])
	}
	if *settings[DataSources].Default != 100 || custom[DataSources] {
		t.Errorf("built-in default = %+v", settings[DataSources])
	}
	if len(settings) != len(registry) {
		t.Errorf("%d settings", len(settings))
	}
	o, err := parseOverrides(json.RawMessage(`{"documents":0,"unknown":5}`))
	if err != nil || len(o) != 1 || o[Documents] != 0 {
		t.Errorf("overrides = %v %v", o, err)
	}
	if o, err := parseOverrides(nil); err != nil || len(o) != 0 {
		t.Errorf("nil overrides = %v %v", o, err)
	}
}

func TestValidation(t *testing.T) {
	d, _ := Lookup(Documents)
	for _, c := range []struct {
		st Setting
		ok bool
	}{
		{Setting{Default: n(10), Ceiling: n(20)}, true},
		{Setting{Default: n(20), Ceiling: n(20)}, true},
		{Setting{Default: nil, Ceiling: nil}, true},
		{Setting{Default: n(0)}, true},
		{Setting{Default: n(30), Ceiling: n(20)}, false},
		{Setting{Default: nil, Ceiling: n(20)}, false}, // unlimited above a ceiling
		{Setting{Default: n(-1)}, false},
	} {
		if err := ValidateSetting(d, c.st); (err == nil) != c.ok {
			t.Errorf("%v/%v: err = %v", deref(c.st.Default), deref(c.st.Ceiling), err)
		}
	}
	if err := ValidateOverride(d, Setting{Ceiling: n(20)}, n(21)); err == nil {
		t.Error("override above ceiling accepted")
	} else if e, _ := apperr.As(err); e.Code != "above_ceiling" {
		t.Errorf("code = %s", e.Code)
	}
	if err := ValidateOverride(d, Setting{Ceiling: n(20)}, n(20)); err != nil {
		t.Error(err)
	}
	if err := ValidateOverride(d, Setting{}, nil); err != nil {
		t.Error(err)
	}
}

func TestErrors(t *testing.T) {
	d, _ := Lookup(DataSources)
	err := error(reached(d, 100, 100))
	e, ok := apperr.As(err)
	if !ok || e.Status != http.StatusConflict || e.Code != "limit_reached" || !strings.Contains(e.Message, "limit of 100 data sources") {
		t.Fatalf("reached = %+v", e)
	}
	if det := e.Details.(map[string]any); det["limit"] != "data_sources" || det["max"] != int64(100) {
		t.Errorf("details = %v", det)
	}
	var le *Error
	if !errors.As(err, &le) || le.Def.Key != DataSources {
		t.Error("not a *limits.Error")
	}
	s, _ := Lookup(StorageBytes)
	if e, _ := apperr.As(reached(s, 10<<30, 10<<30)); !strings.Contains(e.Message, "storage limit of 10 GiB") {
		t.Errorf("storage message = %s", e.Message)
	}
	if e, _ := apperr.As(Blocked(KnowledgeBases)); !strings.Contains(e.Message, "blocked") {
		t.Errorf("blocked message = %s", e.Message)
	}
	q, _ := Lookup(QueriesPerMinute)
	e, _ = apperr.As(rateLimited(q, 60, 60, 12*time.Second))
	if e.Status != http.StatusTooManyRequests || e.Code != "rate_limited" || e.RetryAfter != 12*time.Second {
		t.Errorf("rate limited = %+v", e)
	}
}

func TestFormatAndDays(t *testing.T) {
	for in, want := range map[int64]string{512: "512 B", 1536: "1.5 KiB", 10 << 30: "10 GiB"} {
		if got := FormatBytes(in); got != want {
			t.Errorf("FormatBytes(%d) = %s", in, got)
		}
	}
	now := time.Date(2026, 9, 26, 23, 59, 0, 0, time.FixedZone("EDT", -4*3600)) // 03:59 UTC on the 27th
	if got := StartOfDay(now); !got.Equal(time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("StartOfDay = %s", got)
	}
	if got := NextDay(now); !got.Equal(time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("NextDay = %s", got)
	}
}
