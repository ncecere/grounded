package auditstream

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Bounds (docs/specs/audit-streaming/DESIGN.md, "Bounds").
const (
	MaxDestinations = 5
	MaxBatch        = 500
	MaxBatchBytes   = 1 << 20
	minBackoff      = 5 * time.Second
	maxBackoff      = 5 * time.Minute
	// FailingAfter is when a failing destination is listed under Needs attention.
	FailingAfter = 15 * time.Minute
)

// AuthAAD is the associated data an authorization header value is sealed with (key rotation re-seals it).
func AuthAAD(id uuid.UUID) []byte {
	return []byte("audit_stream_destinations.auth_header:" + id.String())
}

// Service stores the settings and destinations and delivers batches.
type Service struct {
	Pool     *pgxpool.Pool
	Box      *secrets.Box
	Sender   *Sender
	Instance string // the instance name, in every event
	Hostname string // syslog HOSTNAME (the APP_URL's host)
	Log      *slog.Logger
	Now      func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

var (
	errRead  = apperr.Forbidden("Only platform admins and auditors can see audit streaming")
	errWrite = apperr.Forbidden("Only a signed-in platform admin can change audit streaming")
)

func readable(a authz.Actor) error {
	if !a.CanReadPlatform() || a.Delegated() {
		return errRead
	}
	return nil
}

func writable(a authz.Actor) error {
	if !a.IsPlatformAdmin() || a.Delegated() {
		return errWrite
	}
	return nil
}

// Settings reads the platform switch.
func (s *Service) Settings(ctx context.Context, a authz.Actor) (dbgen.AuditStreamSetting, error) {
	if err := readable(a); err != nil {
		return dbgen.AuditStreamSetting{}, err
	}
	return dbgen.New(s.Pool).GetAuditStreamSettings(ctx)
}

// SetEnabled turns streaming on or off for the platform (If-Match; audited). Off pauses every destination where it is.
func (s *Service) SetEnabled(ctx context.Context, a authz.Actor, enabled bool, revision int64) (dbgen.AuditStreamSetting, error) {
	if err := writable(a); err != nil {
		return dbgen.AuditStreamSetting{}, err
	}
	var out dbgen.AuditStreamSetting
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockAuditStreamSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != revision {
			return apperr.Stale()
		}
		if out, err = q.SetAuditStreamSettings(ctx, dbgen.SetAuditStreamSettingsParams{Enabled: enabled, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}}); err != nil {
			return err
		}
		e := a.Audit("platform.audit_streaming", "audit_stream_settings", "settings")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": out.Enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Destination is a destination as shown (never the header value).
type Destination = dbgen.ListAuditStreamDestinationsRow

// List returns the destinations (platform admins and auditors).
func (s *Service) List(ctx context.Context, a authz.Actor) ([]Destination, error) {
	if err := readable(a); err != nil {
		return nil, err
	}
	return dbgen.New(s.Pool).ListAuditStreamDestinations(ctx)
}

// Lag is how long the oldest unsent entry has waited (zero when nothing waits or the destination never started).
func (s *Service) Lag(ctx context.Context, id uuid.UUID) (time.Duration, error) {
	q := dbgen.New(s.Pool)
	d, err := q.GetAuditStreamDestination(ctx, id)
	if err != nil || d.CursorTxid == "" {
		return 0, err
	}
	oldest, err := q.AuditStreamOldestUnsent(ctx, dbgen.AuditStreamOldestUnsentParams{CursorTxid: d.CursorTxid, CursorID: d.CursorID})
	if err != nil {
		return 0, err
	}
	return max(s.now().Sub(oldest), 0), nil
}

// Input is a destination's settings as an admin sends them. AuthHeader nil keeps the stored value; "" removes it.
type Input struct {
	Name, Kind, Format, Address, CAPEM string
	AuthHeader                         *string
}

func (in *Input) check(kindFixed string) error {
	in.Name, in.Address, in.CAPEM = strings.TrimSpace(in.Name), strings.TrimSpace(in.Address), strings.TrimSpace(in.CAPEM)
	if kindFixed != "" {
		in.Kind = kindFixed
	}
	if in.Name == "" || len(in.Name) > 100 {
		return apperr.Invalid("invalid_name", "Name the destination (1-100 characters)")
	}
	if err := ValidateAddress(in.Kind, in.Address); err != nil {
		return apperr.Invalid("invalid_address", "The address is not valid: "+err.Error())
	}
	switch {
	case in.Kind == KindHTTPS && in.Format != FormatSplunkHEC && in.Format != FormatNDJSON:
		return apperr.Invalid("invalid_format", "An HTTPS destination sends splunk_hec or ndjson")
	case in.Kind == KindSyslog:
		in.Format = FormatRFC5424
	}
	if in.Kind == KindSyslog && in.AuthHeader != nil && *in.AuthHeader != "" {
		return apperr.Invalid("invalid_auth", "A syslog destination has no authorization header")
	}
	if in.AuthHeader != nil && (len(*in.AuthHeader) > 4096 || strings.ContainsAny(*in.AuthHeader, "\r\n")) {
		return apperr.Invalid("invalid_auth", "The authorization header value is at most 4096 characters, on one line")
	}
	if len(in.CAPEM) > 65536 || (in.CAPEM != "" && !strings.Contains(in.CAPEM, "BEGIN CERTIFICATE")) {
		return apperr.Invalid("invalid_ca", "The CA certificate must be PEM (-----BEGIN CERTIFICATE-----)")
	}
	return nil
}

// errOff refuses new and changed destinations while the platform switch is off.
var errOff = apperr.Conflict("streaming_off", "Turn audit streaming on in Admin → Settings → Features first")

func (s *Service) seal(id uuid.UUID, value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	return s.Box.Seal([]byte(value), AuthAAD(id))
}

// Create adds a destination, off (a signed-in platform admin; audited, without the header value).
func (s *Service) Create(ctx context.Context, a authz.Actor, in Input) (uuid.UUID, error) {
	if err := writable(a); err != nil {
		return uuid.Nil, err
	}
	if err := in.check(""); err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		st, err := q.LockAuditStreamSettings(ctx)
		if err != nil {
			return err
		}
		if !st.Enabled {
			return errOff
		}
		if n, err := q.CountAuditStreamDestinations(ctx); err != nil {
			return err
		} else if n >= MaxDestinations {
			return apperr.Conflict("too_many_destinations", "At most 5 streaming destinations")
		}
		if id, err = q.InsertAuditStreamDestination(ctx, dbgen.InsertAuditStreamDestinationParams{Name: in.Name, Kind: in.Kind, Format: in.Format,
			Address: in.Address, CaPem: in.CAPEM, CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}}); err != nil {
			return err
		}
		if in.AuthHeader != nil && *in.AuthHeader != "" {
			sealed, err := s.seal(id, *in.AuthHeader)
			if err != nil {
				return err
			}
			if err := q.UpdateAuditStreamDestination(ctx, dbgen.UpdateAuditStreamDestinationParams{ID: id, Name: in.Name, Format: in.Format,
				Address: in.Address, AuthHeader: sealed, CaPem: in.CAPEM}); err != nil {
				return err
			}
		}
		e := a.Audit("platform.audit_stream_create", "audit_stream_destination", id.String())
		e.After = snapshot(in.Name, in.Kind, in.Format, in.Address, in.AuthHeader != nil && *in.AuthHeader != "", false)
		return audit.Record(ctx, q, e)
	})
	return id, err
}

func snapshot(name, kind, format, address string, hasAuth, enabled bool) map[string]any {
	return map[string]any{"name": name, "kind": kind, "format": format, "address": address, "hasAuthHeader": hasAuth, "enabled": enabled}
}

// lockDest locks a destination and checks its revision.
func lockDest(ctx context.Context, q *dbgen.Queries, id uuid.UUID, revision int64) (dbgen.LockAuditStreamDestinationRow, error) {
	d, err := q.LockAuditStreamDestination(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, apperr.NotFound("not_found", "Streaming destination not found")
	} else if err != nil {
		return d, err
	}
	if d.Revision != revision {
		return d, apperr.Stale()
	}
	return d, nil
}

// Update changes a destination's settings (its kind stays). The cursor is kept: changing the address doesn't resend.
func (s *Service) Update(ctx context.Context, a authz.Actor, id uuid.UUID, in Input, revision int64) error {
	if err := writable(a); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		d, err := lockDest(ctx, q, id, revision)
		if err != nil {
			return err
		}
		if err := in.check(d.Kind); err != nil {
			return err
		}
		sealed := d.AuthHeader
		if in.AuthHeader != nil {
			if sealed, err = s.seal(id, *in.AuthHeader); err != nil {
				return err
			}
		}
		if err := q.UpdateAuditStreamDestination(ctx, dbgen.UpdateAuditStreamDestinationParams{ID: id, Name: in.Name, Format: in.Format,
			Address: in.Address, AuthHeader: sealed, CaPem: in.CAPEM}); err != nil {
			return err
		}
		e := a.Audit("platform.audit_stream_update", "audit_stream_destination", id.String())
		e.Before = snapshot(d.Name, d.Kind, d.Format, d.Address, d.AuthHeader != nil, d.Enabled)
		e.After = snapshot(in.Name, d.Kind, in.Format, in.Address, sealed != nil, d.Enabled)
		return audit.Record(ctx, q, e)
	})
}

// SetDestinationEnabled turns a destination on or off. The first time on, it starts with the entries written from then on.
func (s *Service) SetDestinationEnabled(ctx context.Context, a authz.Actor, id uuid.UUID, enabled bool, revision int64) error {
	if err := writable(a); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if enabled {
			st, err := q.GetAuditStreamSettings(ctx)
			if err != nil {
				return err
			}
			if !st.Enabled {
				return errOff
			}
		}
		d, err := lockDest(ctx, q, id, revision)
		if err != nil {
			return err
		}
		if d.Enabled == enabled {
			return nil
		}
		if err := q.SetAuditStreamDestinationEnabled(ctx, dbgen.SetAuditStreamDestinationEnabledParams{ID: id, Enabled: enabled}); err != nil {
			return err
		}
		action := "platform.audit_stream_disable"
		if enabled {
			action = "platform.audit_stream_enable"
		}
		e := a.Audit(action, "audit_stream_destination", id.String())
		e.Metadata = map[string]any{"name": d.Name}
		return audit.Record(ctx, q, e)
	})
}

// Delete removes a destination (allowed while streaming is off).
func (s *Service) Delete(ctx context.Context, a authz.Actor, id uuid.UUID, revision int64) error {
	if err := writable(a); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		d, err := lockDest(ctx, q, id, revision)
		if err != nil {
			return err
		}
		if _, err := q.DeleteAuditStreamDestination(ctx, id); err != nil {
			return err
		}
		e := a.Audit("platform.audit_stream_delete", "audit_stream_destination", id.String())
		e.Before = snapshot(d.Name, d.Kind, d.Format, d.Address, d.AuthHeader != nil, d.Enabled)
		return audit.Record(ctx, q, e)
	})
}

// Test sends one test event to a destination and reports the outcome class ("" when delivered). The test is audited; the
// event itself isn't stored.
func (s *Service) Test(ctx context.Context, a authz.Actor, id uuid.UUID) (string, error) {
	if err := writable(a); err != nil {
		return "", err
	}
	q := dbgen.New(s.Pool)
	d, err := q.GetAuditStreamDestination(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", apperr.NotFound("not_found", "Streaming destination not found")
	} else if err != nil {
		return "", err
	}
	sendErr := s.send(ctx, d, []Event{TestEvent(s.Instance, s.now())})
	class := ""
	if sendErr != nil {
		class = Class(sendErr)
	}
	e := a.Audit("platform.audit_stream_test", "audit_stream_destination", id.String())
	e.Metadata = map[string]any{"name": d.Name, "outcome": map[bool]string{true: "delivered", false: class}[class == ""]}
	if err := audit.Record(ctx, q, e); err != nil {
		return "", err
	}
	return class, nil
}

// send delivers events to a destination.
func (s *Service) send(ctx context.Context, d dbgen.GetAuditStreamDestinationRow, events []Event) error {
	auth := ""
	if d.AuthHeader != nil {
		plain, err := s.Box.Open(d.AuthHeader, AuthAAD(d.ID))
		if err != nil {
			return fail(ClassInternal, errors.New("the authorization header could not be decrypted"))
		}
		auth = string(plain)
	}
	if d.Kind == KindSyslog {
		frames := make([][]byte, 0, len(events))
		for _, e := range events {
			f, err := syslogFrame(s.Hostname, e)
			if err != nil {
				return fail(ClassInternal, err)
			}
			frames = append(frames, f)
		}
		return s.Sender.SendSyslog(ctx, d.Address, d.CaPem, frames)
	}
	body, ctype, err := httpBody(d.Format, events)
	if err != nil {
		return fail(ClassInternal, err)
	}
	return s.Sender.PostHTTPS(ctx, d.Address, auth, ctype, d.CaPem, body)
}
