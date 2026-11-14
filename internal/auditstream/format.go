// Package auditstream streams audit entries to a SIEM (E5, #36; docs/specs/audit-streaming/DESIGN.md): HTTPS (Splunk HEC or
// NDJSON) or syslog over TLS (RFC 5424, RFC 5425 framing), in commit order, at least once. Only the audit facts leave
// Grounded: never before/after states, metadata, labels or any content.
package auditstream

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/strutil"
)

// Kinds and formats.
const (
	KindHTTPS  = "https"
	KindSyslog = "syslog"

	FormatSplunkHEC = "splunk_hec"
	FormatNDJSON    = "ndjson"
	FormatRFC5424   = "rfc5424"
)

// Event is what a SIEM receives for one audit entry (the design's projection).
type Event struct {
	Source      string `json:"source"`
	Instance    string `json:"instance"`
	ID          int64  `json:"id"`
	OccurredAt  string `json:"occurredAt"`
	ActorKind   string `json:"actorKind"`
	ActorUserID string `json:"actorUserId"`
	ActorEmail  string `json:"actorEmail"`
	APIKeyID    string `json:"apiKeyId"`
	TeamID      string `json:"teamId"`
	TeamSlug    string `json:"teamSlug"`
	Action      string `json:"action"`
	TargetType  string `json:"targetType"`
	TargetID    string `json:"targetId"`
	RequestID   string `json:"requestId"`
	ClientIP    string `json:"clientIp"`
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_.]{0,63}$`)

// safeIdent keeps a protocol identifier (an action, a target type); anything else is "redacted", as in the export.
func safeIdent(s string) string {
	if identifier.MatchString(s) {
		return s
	}
	return "redacted"
}

func uuidOrEmpty(s string) string {
	if id, err := uuid.Parse(s); err == nil {
		return id.String()
	}
	return ""
}

func nullID(id uuid.NullUUID) string {
	if id.Valid {
		return id.UUID.String()
	}
	return ""
}

// ToEvent projects an entry. A target that isn't a UUID (a URL, a pattern, a settings key) is left out, as in the export.
func ToEvent(instance string, r dbgen.NextAuditStreamEntriesRow) Event {
	return Event{
		Source: "grounded", Instance: strutil.TruncateBytes(instance, 100), ID: r.ID, OccurredAt: r.OccurredAt.UTC().Format(time.RFC3339Nano),
		ActorKind: safeIdent(r.ActorKind), ActorUserID: nullID(r.ActorUserID), ActorEmail: strutil.TruncateBytes(r.ActorEmail, 320),
		APIKeyID: uuidOrEmpty(r.APIKeyID), TeamID: nullID(r.TeamID), TeamSlug: strutil.TruncateBytes(r.TeamSlug, 100),
		Action: safeIdent(r.Action), TargetType: safeIdent(r.TargetType), TargetID: uuidOrEmpty(r.TargetID),
		RequestID: strutil.TruncateBytes(r.RequestID, 100), ClientIP: strutil.TruncateBytes(r.ClientIP, 64),
	}
}

// TestEvent is the entry a Test sends: marked as a test, never stored in the audit log.
func TestEvent(instance string, now time.Time) Event {
	return Event{Source: "grounded", Instance: strutil.TruncateBytes(instance, 100), OccurredAt: now.UTC().Format(time.RFC3339Nano), ActorKind: "system",
		Action: "audit_stream.test", TargetType: "audit_stream_destination"}
}

// hecEvent is Splunk's HTTP Event Collector envelope.
type hecEvent struct {
	Time       float64 `json:"time"`
	Host       string  `json:"host"`
	Source     string  `json:"source"`
	Sourcetype string  `json:"sourcetype"`
	Event      Event   `json:"event"`
}

// httpBody renders a batch for an HTTPS destination, with its content type.
func httpBody(format string, events []Event) ([]byte, string, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	for _, e := range events {
		var v any = e
		if format == FormatSplunkHEC {
			t, _ := time.Parse(time.RFC3339Nano, e.OccurredAt)
			v = hecEvent{Time: float64(t.UnixMicro()) / 1e6, Host: e.Instance, Source: "grounded", Sourcetype: "grounded:audit", Event: e}
		}
		if err := enc.Encode(v); err != nil {
			return nil, "", err
		}
	}
	if format == FormatSplunkHEC {
		return b.Bytes(), "application/json", nil
	}
	return b.Bytes(), "application/x-ndjson", nil
}

// sdSafe makes a value safe for an RFC 5424 header field: printable ASCII without spaces, else "-".
func sdSafe(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if r < 33 || r > 126 {
			return -1
		}
		return r
	}, s)
	if s == "" {
		return "-"
	}
	return strutil.TruncateBytes(s, max)
}

// syslogFrame renders one event as an RFC 5424 message with RFC 5425 octet-counting framing ("LEN SP MSG"). Facility 13
// (log audit), severity 6 (informational): PRI 110. MSGID is the action; MSG is the event's JSON.
func syslogFrame(hostname string, e Event) ([]byte, error) {
	body, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	ts := e.OccurredAt
	if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		ts = t.UTC().Format("2006-01-02T15:04:05.000000Z07:00")
	}
	msg := fmt.Sprintf("<110>1 %s %s grounded - %s - %s", ts, sdSafe(hostname, 255), sdSafe(e.Action, 32), body)
	return []byte(fmt.Sprintf("%d %s", len(msg), msg)), nil
}
