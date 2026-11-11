package sourcesync

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/sourcetypes"
)

func TestHold(t *testing.T) {
	s := &Service{HoldPercent: 30, HoldMinimum: 10}
	for _, c := range []struct {
		removals, total int64
		held            bool
	}{
		{0, 0, false}, {0, 100, false},
		{1, 1, true},       // the only document
		{100, 100, true},   // everything
		{120, 100, true},   // more than everything (documents added meanwhile)
		{3, 5, false},      // most of a small source, but not all and under the minimum
		{9, 20, false},     // under the minimum
		{10, 20, true},     // at the minimum and over the share
		{30, 100, false},   // exactly the share
		{31, 100, true},    // over it
		{50, 10000, false}, // many, but a small share
	} {
		if got := s.hold(c.removals, c.total) != ""; got != c.held {
			t.Errorf("hold(%d of %d) = %v, want %v", c.removals, c.total, got, c.held)
		}
	}
}

func TestResolveFailsClosed(t *testing.T) {
	src := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	user := "22222222-2222-2222-2222-222222222222"
	if got, acl := resolve(src, nil); got == nil || len(got) != 0 || !strings.Contains(string(acl), "reported no permissions") {
		t.Errorf("no report = %v %s, want nobody with a note", got, acl)
	}
	if got, _ := resolve(src, &connector.Permissions{Everyone: true, Principals: []string{"group:x"}}); got != nil {
		t.Errorf("everyone = %v, want unrestricted", got)
	}
	if got, _ := resolve(src, &connector.Permissions{}); got == nil || len(got) != 0 {
		t.Errorf("an empty list = %v, want nobody", got)
	}
	got, acl := resolve(src, &connector.Permissions{
		Principals: []string{" Email:Ana@Example.EDU ", "group:Staff", "group:staff", "user:" + user, "subject:ABC-123",
			"everyone", "role:admin", "email:nobody", "user:not-a-uuid", "source:" + src.String() + ":x", "group:", "*"},
		Groups: []string{"Site Owners", "", strings.Repeat("g", 500)},
		Raw:    []byte(`{"shared":"with staff"}`),
	})
	want := []string{"email:ana@example.edu", "group:staff", "source:" + src.String() + ":site owners", "subject:abc-123", "user:" + user}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("principals = %v\n want %v", got, want)
	}
	if !strings.Contains(string(acl), "9 entries could not be matched") || !strings.Contains(string(acl), `"shared":"with staff"`) {
		t.Errorf("acl = %s", acl)
	}
	many := make([]string, maxItemPrincipals+1)
	for i := range many {
		many[i] = "group:g" + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + uuid.NewString()
	}
	if got, acl := resolve(src, &connector.Permissions{Principals: many}); len(got) != 0 || !strings.Contains(string(acl), "nobody can read it") {
		t.Errorf("a list too long to keep = %d principals, want nobody", len(got))
	}
	if got, _ := resolve(src, &connector.Permissions{Principals: []string{"group:a"}, Raw: []byte("{not json")}); len(got) != 1 {
		t.Errorf("raw permissions that are not JSON must not lose the list: %v", got)
	}
}

func TestGroupMembers(t *testing.T) {
	got := groupMembers([]string{"email:A@example.org", "email:a@example.org", "nobody", "group:x", "source:1:2"})
	if strings.Join(got, "|") != "email:a@example.org|group:x" {
		t.Errorf("members = %v", got)
	}
}

func TestCredentials(t *testing.T) {
	typ := sourcetypes.Type{Credentials: []sourcetypes.Field{
		{Key: "token", Label: "Access token", Required: true, Secret: true}, {Key: "account", Label: "Account"}}}
	for name, c := range map[string]struct {
		values   map[string]string
		complete bool
		code     string
	}{
		"complete":            {map[string]string{"token": "t"}, true, ""},
		"missing required":    {map[string]string{"account": "a"}, true, "credentials_missing"},
		"blank required":      {map[string]string{"token": "  "}, true, "credentials_missing"},
		"partial update":      {map[string]string{"account": "a"}, false, ""},
		"unknown field":       {map[string]string{"token": "t", "password": "p"}, true, "invalid_credentials"},
		"too long":            {map[string]string{"token": strings.Repeat("x", maxCredential+1)}, true, "invalid_credentials"},
		"none, nothing asked": {nil, false, ""},
	} {
		if got := codeOf(checkCredentials(typ, c.values, c.complete)); got != c.code {
			t.Errorf("%s: %q, want %q", name, got, c.code)
		}
	}
	got := merge(map[string]string{"token": "old", "account": "a"}, map[string]string{"token": "new", "account": " "})
	if len(got) != 1 || got["token"] != "new" {
		t.Errorf("merge = %v", got)
	}
}

func codeOf(err error) string {
	if e, ok := apperr.As(err); ok {
		return e.Code
	}
	return ""
}

func TestRedact(t *testing.T) {
	creds := map[string]string{"token": "s3cr3t-token-value", "short": "abc"}
	got := redact("GET https://api.example.org/?access_token=s3cr3t-token-value failed for abc: 401", creds)
	if strings.Contains(got, "s3cr3t") || !strings.Contains(got, "[redacted]") || !strings.Contains(got, "abc") {
		t.Errorf("redact = %q", got)
	}
	if got := redact(strings.Repeat("x", 2000), nil); len(got) > 510 {
		t.Errorf("a long message is cut: %d", len(got))
	}
}

func TestSchedule(t *testing.T) {
	from := time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC)
	for schedule, want := range map[string]time.Duration{ScheduleHourly: time.Hour, ScheduleDaily: 24 * time.Hour, ScheduleWeekly: 168 * time.Hour} {
		if got := NextSync(schedule, from); got == nil || got.Sub(from) != want || !ValidSchedule(schedule) {
			t.Errorf("%s: %v", schedule, got)
		}
	}
	if NextSync(ScheduleManual, from) != nil || NextSync("yearly", from) != nil || ValidSchedule("yearly") || !ValidSchedule(ScheduleManual) {
		t.Error("manual and unknown schedules have no next sync")
	}
}

func TestClipURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://files.example.org/a": "https://files.example.org/a", "http://intranet/a": "http://intranet/a",
		"javascript:alert(1)": "", "file:///etc/passwd": "", "": "", "https://x/" + strings.Repeat("a", 3000): "",
	} {
		if got := clipURL(in); got != want {
			t.Errorf("clipURL(%.30q) = %.30q", in, got)
		}
	}
}
