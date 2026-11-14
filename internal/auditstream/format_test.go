package auditstream

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/netip"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func row() dbgen.NextAuditStreamEntriesRow {
	return dbgen.NextAuditStreamEntriesRow{
		ID: 42, OccurredAt: time.Date(2026, 11, 5, 10, 0, 0, 123456000, time.UTC), ActorKind: "user",
		ActorUserID: uuid.NullUUID{UUID: uuid.MustParse("11111111-1111-4111-8111-111111111111"), Valid: true}, ActorEmail: "ada@example.edu",
		TeamID: uuid.NullUUID{UUID: uuid.MustParse("22222222-2222-4222-8222-222222222222"), Valid: true}, TeamSlug: "registrar",
		Action: "agent.publish", TargetType: "agent", TargetID: "33333333-3333-4333-8333-333333333333", RequestID: "req-1", ClientIP: "203.0.113.9",
		APIKeyID: "",
	}
}

// Only the facts leave: identifiers that aren't protocol words are redacted, and a target that isn't a UUID is dropped.
func TestProjection(t *testing.T) {
	e := ToEvent("Grounded", row())
	if e.ID != 42 || e.OccurredAt != "2026-11-05T10:00:00.123456Z" || e.ActorEmail != "ada@example.edu" || e.TeamSlug != "registrar" ||
		e.TargetID != "33333333-3333-4333-8333-333333333333" || e.Source != "grounded" {
		t.Fatalf("event = %+v", e)
	}
	r := row()
	r.Action, r.TargetType, r.TargetID, r.APIKeyID = "Agent Publish!", "x y", "https://example.edu/secret?q=1", "not-a-uuid"
	e = ToEvent("Grounded", r)
	if e.Action != "redacted" || e.TargetType != "redacted" || e.TargetID != "" || e.APIKeyID != "" {
		t.Fatalf("unsafe values passed through: %+v", e)
	}
	raw, _ := json.Marshal(e)
	for _, k := range []string{"before", "after", "metadata", "label"} {
		if strings.Contains(strings.ToLower(string(raw)), `"`+k) {
			t.Errorf("the event has a %s field: %s", k, raw)
		}
	}
}

func TestHTTPBodies(t *testing.T) {
	events := []Event{ToEvent("Grounded", row()), TestEvent("Grounded", time.Unix(0, 0))}
	body, ctype, err := httpBody(FormatNDJSON, events)
	if err != nil || ctype != "application/x-ndjson" {
		t.Fatal(err, ctype)
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	var first Event
	if len(lines) != 2 || json.Unmarshal([]byte(lines[0]), &first) != nil || first.ID != 42 {
		t.Fatalf("ndjson = %s", body)
	}
	body, ctype, err = httpBody(FormatSplunkHEC, events[:1])
	var hec struct {
		Time       float64 `json:"time"`
		Sourcetype string  `json:"sourcetype"`
		Event      Event   `json:"event"`
	}
	if err != nil || ctype != "application/json" || json.Unmarshal(body, &hec) != nil || hec.Sourcetype != "grounded:audit" || hec.Event.ID != 42 ||
		hec.Time != 1793872800.123456 {
		t.Fatalf("hec = %s (%+v)", body, hec)
	}
}

// RFC 5424 with RFC 5425 octet counting: "LEN SP <110>1 TIMESTAMP HOST grounded - MSGID - JSON".
func TestSyslogFrame(t *testing.T) {
	f, err := syslogFrame("grounded.example.edu", ToEvent("Grounded", row()))
	if err != nil {
		t.Fatal(err)
	}
	r := bufio.NewReader(bytes.NewReader(f))
	n, _ := r.ReadString(' ')
	length, err := strconv.Atoi(strings.TrimSpace(n))
	rest := f[len(n):]
	if err != nil || length != len(rest) {
		t.Fatalf("frame length %q vs %d", n, len(rest))
	}
	want := "<110>1 2026-11-05T10:00:00.123456Z grounded.example.edu grounded - agent.publish - {"
	if !strings.HasPrefix(string(rest), want) {
		t.Fatalf("message = %s", rest)
	}
	if f2, _ := syslogFrame("bad host\nname", TestEvent("x", time.Unix(0, 0))); !strings.Contains(string(f2), " badhostname grounded - audit_stream.test - ") {
		t.Fatalf("header not sanitised: %s", f2)
	}
}

func TestAddressRules(t *testing.T) {
	for addr, want := range map[string]bool{
		"10.1.2.3": true, "192.168.1.10": true, "203.0.113.5": true, "2001:db8::1": true,
		"127.0.0.1": false, "::1": false, "169.254.169.254": false, "fe80::1": false, "0.0.0.0": false, "fd00:ec2::254": false, "224.0.0.1": false,
	} {
		if got := allowedAddr(netip.MustParseAddr(addr)); got != want {
			t.Errorf("allowedAddr(%s) = %v", addr, got)
		}
	}
	for _, c := range []struct {
		kind, addr string
		ok         bool
	}{
		{KindHTTPS, "https://siem.example.edu/services/collector/event", true},
		{KindHTTPS, "http://siem.example.edu/", false},
		{KindHTTPS, "https://user:pw@siem.example.edu/", false},
		{KindSyslog, "siem.example.edu:6514", true},
		{KindSyslog, "siem.example.edu", false},
		{KindSyslog, "siem.example.edu:70000", false},
		{"udp", "x:1", false},
	} {
		if err := ValidateAddress(c.kind, c.addr); (err == nil) != c.ok {
			t.Errorf("ValidateAddress(%s, %s) = %v", c.kind, c.addr, err)
		}
	}
}

func TestBackoff(t *testing.T) {
	if backoff(0) != 5*time.Second || backoff(1) != 10*time.Second || backoff(20) != 5*time.Minute {
		t.Fatal(backoff(0), backoff(1), backoff(20))
	}
}
