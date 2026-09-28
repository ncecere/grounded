// Reading sessions: the admin lists and read logs (platform admins and
// auditors), the reading admin's own open sessions (the banner) and a
// team's active sessions (the owners' notice).

package breakglass

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Team names a session's team.
type Team struct {
	ID   uuid.UUID
	Slug string
	Name string
}

// Session is a session as people see it. Status is the effective status
// (an active session past its end reads as expired before the sweep).
type Session struct {
	dbgen.BreakGlassSession
	Team        Team
	RequestedBy Person
	DecidedBy   Person
	EndedBy     Person
	// Reads counts what the session read, by kind (Get only).
	Reads []dbgen.BreakGlassReadCountsRow
}

type sessionRow struct {
	b             dbgen.BreakGlassSession
	slug, name    string
	rName, rEmail string
	dName, dEmail string
	eName, eEmail string
}

func (s *Service) view(r sessionRow) Session {
	out := Session{
		BreakGlassSession: r.b, Team: Team{ID: r.b.TeamID, Slug: r.slug, Name: r.name},
		RequestedBy: person(uuid.NullUUID{UUID: r.b.RequestedBy, Valid: true}, r.rName, r.rEmail),
		DecidedBy:   person(r.b.DecidedBy, r.dName, r.dEmail),
		EndedBy:     person(r.b.EndedBy, r.eName, r.eEmail),
	}
	out.Status = rule(r.b).EffectiveStatus(s.now())
	return out
}

func (s *Service) get(ctx context.Context, id uuid.UUID) (Session, error) {
	r, err := s.q.GetBreakGlassSession(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Session{}, errNoSession
	} else if err != nil {
		return Session{}, err
	}
	v := s.view(sessionRow{r.BreakGlassSession, r.TeamSlug, r.TeamName, r.RequestedByName, r.RequestedByEmail,
		r.DecidedByName, r.DecidedByEmail, r.EndedByName, r.EndedByEmail})
	if v.Reads, err = s.q.BreakGlassReadCounts(ctx, id.String()); err != nil {
		return Session{}, err
	}
	return v, nil
}

// Get returns a session with its read counts (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor, id uuid.UUID) (Session, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Session{}, errReadOnly
	}
	return s.get(ctx, id)
}

// Filter narrows a session list.
type Filter struct {
	// Open: pending and active only (true), or the others (false); nil: all.
	Open   *bool
	TeamID *uuid.UUID
	// Mine: only the actor's sessions.
	Mine bool
}

// Cursor is the position after the last listed session.
type Cursor struct {
	RequestedAt time.Time
	ID          uuid.UUID
}

// List lists sessions newest first (platform admins and auditors). It
// records due expiries first, so the list is current.
func (s *Service) List(ctx context.Context, a authz.Actor, f Filter, after *Cursor, limit int32) ([]Session, *Cursor, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, nil, errReadOnly
	}
	if _, err := s.Sweep(ctx); err != nil && s.Log != nil {
		s.Log.WarnContext(ctx, "break-glass sweep failed", "err", err)
	}
	p := dbgen.ListBreakGlassSessionsParams{PageSize: limit + 1}
	if f.Open != nil {
		p.Open = pgtype.Bool{Bool: *f.Open, Valid: true}
	}
	if f.TeamID != nil {
		p.TeamID = uuid.NullUUID{UUID: *f.TeamID, Valid: true}
	}
	if f.Mine {
		p.RequestedBy = uuid.NullUUID{UUID: a.UserID, Valid: true}
	}
	if after != nil {
		p.BeforeRequested, p.BeforeID = &after.RequestedAt, uuid.NullUUID{UUID: after.ID, Valid: true}
	}
	rows, err := s.q.ListBreakGlassSessions(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	var next *Cursor
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1].BreakGlassSession
		next = &Cursor{RequestedAt: last.RequestedAt, ID: last.ID}
	}
	out := make([]Session, len(rows))
	for i, r := range rows {
		out[i] = s.view(sessionRow{r.BreakGlassSession, r.TeamSlug, r.TeamName, r.RequestedByName, r.RequestedByEmail,
			r.DecidedByName, r.DecidedByEmail, r.EndedByName, r.EndedByEmail})
	}
	return out, next, nil
}

// Mine returns the actor's open sessions (pending and active), for the
// banner. Anyone signed in may ask; people who aren't platform admins have
// none.
func (s *Service) Mine(ctx context.Context, a authz.Actor) ([]Session, error) {
	if s == nil || a.Key != nil || !a.IsPlatformAdmin() {
		return []Session{}, nil
	}
	open := true
	list, _, err := s.List(ctx, a, Filter{Open: &open, Mine: true}, nil, 50)
	return openOnly(list), err
}

// ForTeam returns a team's active sessions, for the notice on its pages:
// the team's owners (and platform admins and auditors) may see them.
func (s *Service) ForTeam(ctx context.Context, a authz.Actor, teamRef string) ([]Session, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return nil, err
	}
	platform := a.Key == nil && a.CanReadPlatform()
	if acc.Role != authz.RoleOwner && !platform {
		return nil, apperr.Forbidden("Only the team's owners can see break-glass sessions on it")
	}
	open := true
	rows, err := s.q.ListBreakGlassSessions(ctx, dbgen.ListBreakGlassSessionsParams{
		Open: pgtype.Bool{Bool: open, Valid: true}, TeamID: uuid.NullUUID{UUID: acc.Team.ID, Valid: true}, PageSize: 50,
	})
	if err != nil {
		return nil, err
	}
	out := []Session{}
	for _, r := range rows {
		v := s.view(sessionRow{r.BreakGlassSession, r.TeamSlug, r.TeamName, r.RequestedByName, r.RequestedByEmail,
			r.DecidedByName, r.DecidedByEmail, r.EndedByName, r.EndedByEmail})
		if v.Status == authz.BreakGlassActive {
			out = append(out, v)
		}
	}
	return out, nil
}

// openOnly drops sessions whose time ran out since the list was read.
func openOnly(list []Session) []Session {
	out := []Session{}
	for _, v := range list {
		if v.Status == authz.BreakGlassPending || v.Status == authz.BreakGlassActive {
			out = append(out, v)
		}
	}
	return out
}

// ReadEntry is one read in a session's read log.
type ReadEntry = dbgen.ListBreakGlassReadsRow

// Reads returns a session's read log, newest first (platform admins and
// auditors). beforeID pages (0: from the newest).
func (s *Service) Reads(ctx context.Context, a authz.Actor, id uuid.UUID, beforeID int64, limit int32) ([]ReadEntry, *int64, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, nil, errReadOnly
	}
	if _, err := s.q.GetBreakGlassSession(ctx, id); errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, nil, errNoSession
	} else if err != nil {
		return nil, nil, err
	}
	p := dbgen.ListBreakGlassReadsParams{SessionID: id.String(), PageSize: limit + 1}
	if beforeID > 0 {
		p.BeforeID = &beforeID
	}
	rows, err := s.q.ListBreakGlassReads(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	var next *int64
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1].ID
		next = &last
	}
	return rows, next, nil
}
