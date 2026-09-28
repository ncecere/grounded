package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Event is one thing that happened, with its rendered text and recipients.
// Build it with the constructors in events.go.
type Event struct {
	Type   Type
	TeamID uuid.UUID // the team it concerns (uuid.Nil: none)
	Actor  uuid.UUID // who caused it (uuid.Nil: the system)
	Title  string    // one line, also the email subject
	Body   string    // plain text, may span lines
	Link   string    // app path, e.g. /teams/registrar ("" = none)
	Data   map[string]any
	// DedupeKey makes the event happen once: recording another event with
	// the same key does nothing.
	DedupeKey string
	// Users are explicit recipients.
	Users []uuid.UUID
	// Emails are explicit addresses, for people who may never have signed
	// in (invites). An address that belongs to one active user reaches that
	// user; otherwise the in-app item waits for their first sign-in.
	Emails []string
}

// By sets who caused the event.
func (e Event) By(actor uuid.UUID) Event { e.Actor = actor; return e }

// Service records and lists notifications.
type Service struct {
	Pool *pgxpool.Pool
	// Jobs enqueues email deliveries (may be insert-only). nil: no email.
	Jobs *river.Client[pgx.Tx]
	// Email reports whether SMTP is configured; when false no email
	// deliveries are recorded.
	Email bool
	Log   *slog.Logger
	// Now is the clock (tests may replace it).
	Now func() time.Time
	q   *dbgen.Queries

	// seen remembers dedupe keys EmitNow already recorded in this process,
	// so a hot path (a team at its daily limit) doesn't write on every call.
	seen sync.Map
}

// New returns a Service.
func New(pool *pgxpool.Pool, jobs *river.Client[pgx.Tx], email bool, log *slog.Logger) *Service {
	return &Service{Pool: pool, Jobs: jobs, Email: email && jobs != nil, Log: log, Now: time.Now, q: dbgen.New(pool)}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// recipient is one person an event reaches: a user, or only an address.
type recipient struct {
	UserID uuid.UUID // uuid.Nil: not signed in yet
	Email  string
}

// person is a candidate recipient read from the database.
type person struct {
	ID       uuid.UUID
	Email    string
	Active   bool
	FromTeam bool // reached through the event's team role
}

// Emit records ev inside tx: the event, an in-app item per recipient whose
// settings allow it, and an email delivery (a River job, run after commit)
// per recipient with email on. An event whose DedupeKey was already used is
// ignored.
func (s *Service) Emit(ctx context.Context, tx pgx.Tx, ev Event) error {
	if s == nil {
		return nil
	}
	def, ok := Lookup(ev.Type)
	if !ok {
		return fmt.Errorf("notify: unknown event type %q", ev.Type)
	}
	q := dbgen.New(tx)
	eventID, ok, err := insertEvent(ctx, q, ev)
	if err != nil || !ok {
		return err
	}
	people, addresses, err := s.candidates(ctx, q, def, ev)
	if err != nil {
		return err
	}
	for _, r := range selectRecipients(def, ev.Actor, people, addresses) {
		if err := s.deliver(ctx, q, tx, def, eventID, r); err != nil {
			return err
		}
	}
	return nil
}

// EmitNow records ev in its own transaction, for events that don't belong
// to one (a daily limit reached while checking a request). Errors are
// logged, not returned: a notification must not fail the request.
func (s *Service) EmitNow(ctx context.Context, ev Event) {
	if s == nil {
		return
	}
	if ev.DedupeKey != "" {
		if _, dup := s.seen.Load(ev.DedupeKey); dup {
			return
		}
	}
	ctx = context.WithoutCancel(ctx)
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error { return s.Emit(ctx, tx, ev) })
	if err != nil {
		s.Log.WarnContext(ctx, "could not record notification", "type", ev.Type, "err", err)
		return
	}
	if ev.DedupeKey != "" {
		s.seen.Store(ev.DedupeKey, struct{}{})
	}
}

func insertEvent(ctx context.Context, q *dbgen.Queries, ev Event) (uuid.UUID, bool, error) {
	data, err := json.Marshal(ev.Data)
	if err != nil || ev.Data == nil {
		data = []byte("{}")
	}
	p := dbgen.InsertNotificationEventParams{
		Type: string(ev.Type), TeamID: nullUUID(ev.TeamID), ActorID: nullUUID(ev.Actor),
		Title: clip(oneLine(ev.Title), 300), Body: clip(ev.Body, 4000), Link: ev.Link, Data: data,
	}
	if ev.DedupeKey != "" {
		p.DedupeKey = &ev.DedupeKey
	}
	id, err := q.InsertNotificationEvent(ctx, p)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil // already recorded
	}
	return id, err == nil, err
}

// candidates reads the people an event may reach: explicit users, users
// behind explicit addresses, and team members with the event's role.
// Addresses nobody (active) uses are returned separately.
func (s *Service) candidates(ctx context.Context, q *dbgen.Queries, def Def, ev Event) ([]person, []string, error) {
	var people []person
	if len(ev.Users) > 0 {
		rows, err := q.NotificationUsers(ctx, ev.Users)
		if err != nil {
			return nil, nil, err
		}
		for _, u := range rows {
			people = append(people, person{ID: u.ID, Email: u.Email, Active: u.Status == "active"})
		}
	}
	var addresses []string
	for _, email := range ev.Emails {
		rows, err := q.NotificationUsersByEmail(ctx, email)
		if err != nil {
			return nil, nil, err
		}
		if len(rows) == 1 {
			people = append(people, person{ID: rows[0].ID, Email: rows[0].Email, Active: rows[0].Status == "active"})
		} else {
			addresses = append(addresses, email)
		}
	}
	if def.TeamRole != "" && ev.TeamID != uuid.Nil {
		rows, err := q.NotificationTeamRecipients(ctx, dbgen.NotificationTeamRecipientsParams{TeamID: ev.TeamID, Roles: teamRoles(def.TeamRole)})
		if err != nil {
			return nil, nil, err
		}
		for _, m := range rows {
			people = append(people, person{ID: m.ID, Email: m.Email, Active: true, FromTeam: true})
		}
	}
	return people, addresses, nil
}

// selectRecipients dedupes candidates, drops suspended users and, unless
// the event is mandatory, the person who caused it.
func selectRecipients(def Def, actor uuid.UUID, people []person, addresses []string) []recipient {
	var out []recipient
	seen := map[string]bool{}
	for _, p := range people {
		key := p.ID.String()
		if !p.Active || seen[key] || (p.ID == actor && actor != uuid.Nil && !def.Mandatory) {
			continue
		}
		seen[key] = true
		out = append(out, recipient{UserID: p.ID, Email: p.Email})
	}
	for _, a := range addresses {
		key := strings.ToLower(a)
		if a == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, recipient{Email: a})
	}
	return out
}

// deliver writes one recipient's in-app item and email delivery, as their
// settings allow. People who have never signed in have no settings.
func (s *Service) deliver(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, def Def, eventID uuid.UUID, r recipient) error {
	var saved *Channels
	if r.UserID != uuid.Nil && !def.Mandatory {
		rows, err := q.NotificationSettingsFor(ctx, dbgen.NotificationSettingsForParams{Type: string(def.Type), UserIds: []uuid.UUID{r.UserID}})
		if err != nil {
			return err
		}
		if len(rows) == 1 {
			saved = &Channels{InApp: rows[0].InApp, Email: rows[0].Email}
		}
	}
	ch := Resolve(def, saved)
	if ch.InApp {
		p := dbgen.InsertNotificationParams{EventID: eventID, Type: string(def.Type), UserID: nullUUID(r.UserID)}
		if r.UserID == uuid.Nil {
			p.Email = &r.Email
		}
		if _, err := q.InsertNotification(ctx, p); err != nil {
			return err
		}
	}
	if !ch.Email || !s.Email || r.Email == "" {
		return nil
	}
	id, err := q.InsertNotificationEmail(ctx, dbgen.InsertNotificationEmailParams{EventID: eventID, UserID: nullUUID(r.UserID), ToAddress: r.Email})
	if err != nil {
		return err
	}
	_, err = s.Jobs.InsertTx(ctx, tx, EmailArgs{DeliveryID: id}, nil)
	return err
}

func nullUUID(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil} }

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
