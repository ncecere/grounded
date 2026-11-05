package scim

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// errLastAdmin refuses to suspend the last active platform admin; the refusal is audited after the rollback.
var errLastAdmin = &Error{Status: http.StatusConflict, Type: "mutability",
	Detail: "This is the last active platform admin; Grounded won't suspend them. Make someone else an admin first."}

func (s *Service) userTx(ctx context.Context, o Origin, fn func(q *dbgen.Queries) error) error {
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// Platform admins first, then the user, as Admin → Users locks them (one order, no deadlock).
		if _, err := q.LockActivePlatformAdmins(ctx); err != nil {
			return err
		}
		return fn(q)
	})
	if errors.Is(err, errLastAdmin) {
		_ = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
			return audit.Record(ctx, q, o.entry("scim.suspend_denied", "user", ""))
		})
	}
	return err
}

// CreateUser creates a user, or links the person who already signed in with the same identifier (never by email).
func (s *Service) CreateUser(ctx context.Context, o Origin, raw []byte) (dbgen.User, error) {
	in, perr := decodeUser(raw)
	if perr != nil {
		return dbgen.User{}, perr
	}
	if perr := in.check(); perr != nil {
		return dbgen.User{}, perr
	}
	var out dbgen.User
	err := s.userTx(ctx, o, func(q *dbgen.Queries) error {
		if _, err := q.GetUserByExternalID(ctx, &in.ExternalID); err == nil {
			return &Error{Status: http.StatusConflict, Type: "uniqueness", Detail: "a user with this externalId already exists"}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err := s.userNameFree(ctx, q, in.UserName, uuid.Nil); err != nil {
			return err
		}
		found, err := q.FindUnlinkedUserByIdentifier(ctx, dbgen.FindUnlinkedUserByIdentifierParams{OIDCIssuer: s.Issuer, Claim: s.MatchClaim, Value: in.ExternalID})
		if err != nil {
			return err
		}
		if len(found) > 1 {
			return &Error{Status: http.StatusConflict, Type: "uniqueness", Detail: "more than one existing user has this identifier"}
		}
		if len(found) == 1 {
			out, err = s.link(ctx, q, o, found[0], in)
			return err
		}
		out, err = s.insert(ctx, q, o, in)
		return err
	})
	return out, err
}

func (s *Service) insert(ctx context.Context, q *dbgen.Queries, o Origin, in userInput) (dbgen.User, error) {
	id := uuid.New()
	status := "active"
	if !in.Active {
		status = "suspended"
	}
	u, err := q.InsertSCIMUser(ctx, dbgen.InsertSCIMUserParams{ID: id, OIDCIssuer: s.Issuer, OIDCSubject: pendingPrefix + id.String(),
		Email: in.address(), DisplayName: in.display(), ScimExternalID: &in.ExternalID, ScimUserName: in.UserName, Status: status})
	if err != nil {
		return u, err
	}
	e := o.entry("scim.user_create", "user", u.ID.String())
	e.After = userSnapshot(u)
	return u, audit.Record(ctx, q, e)
}

func (s *Service) link(ctx context.Context, q *dbgen.Queries, o Origin, u dbgen.User, in userInput) (dbgen.User, error) {
	before := userSnapshot(u)
	u, err := q.LinkSCIMUser(ctx, dbgen.LinkSCIMUserParams{ID: u.ID, ScimExternalID: &in.ExternalID, ScimUserName: in.UserName})
	if err != nil {
		return u, err
	}
	e := o.entry("scim.user_link", "user", u.ID.String())
	e.Before, e.After = before, userSnapshot(u)
	if err := audit.Record(ctx, q, e); err != nil {
		return u, err
	}
	return s.apply(ctx, q, o, u, in)
}

// userNameFree checks userName is unique among SCIM users (RFC 7643 §4.1.1).
func (s *Service) userNameFree(ctx context.Context, q *dbgen.Queries, userName string, self uuid.UUID) error {
	rows, err := q.ListSCIMUsers(ctx, dbgen.ListSCIMUsersParams{UserName: &userName, Take: 2})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.ID != self {
			return &Error{Status: http.StatusConflict, Type: "uniqueness", Detail: "another user has this userName"}
		}
	}
	return nil
}

func userSnapshot(u dbgen.User) map[string]any {
	return map[string]any{"userName": u.ScimUserName, "displayName": u.DisplayName, "email": string(u.Email), "status": u.Status}
}

func inputOf(u dbgen.User) userInput {
	in := userInput{UserName: u.ScimUserName, DisplayName: u.DisplayName, Email: string(u.Email), Active: u.Status == "active"}
	if u.ScimExternalID != nil {
		in.ExternalID = *u.ScimExternalID
	}
	return in
}

// apply makes a user what the input says: names and email, then active status.
func (s *Service) apply(ctx context.Context, q *dbgen.Queries, o Origin, u dbgen.User, in userInput) (dbgen.User, error) {
	if perr := in.check(); perr != nil {
		return u, perr
	}
	if err := s.userNameFree(ctx, q, in.UserName, u.ID); err != nil {
		return u, err
	}
	if in.UserName != u.ScimUserName || in.display() != u.DisplayName || !strings.EqualFold(in.address(), string(u.Email)) {
		before := userSnapshot(u)
		var err error
		if u, err = q.UpdateSCIMUser(ctx, dbgen.UpdateSCIMUserParams{ID: u.ID, Email: in.address(), DisplayName: in.display(), ScimUserName: in.UserName}); err != nil {
			return u, err
		}
		e := o.entry("scim.user_update", "user", u.ID.String())
		e.Before, e.After = before, userSnapshot(u)
		if err := audit.Record(ctx, q, e); err != nil {
			return u, err
		}
	}
	return s.setActive(ctx, q, o, u, in.Active)
}

// setActive suspends or reactivates, as Admin → Users does: a suspension ends the person's sessions in the same
// transaction (keys, connected apps and MCP tokens check the status at each use). The last active admin is never suspended.
func (s *Service) setActive(ctx context.Context, q *dbgen.Queries, o Origin, u dbgen.User, active bool) (dbgen.User, error) {
	status := "suspended"
	if active {
		status = "active"
	}
	if status == u.Status {
		return u, nil
	}
	if !active && u.PlatformRole == authz.PlatformAdmin {
		admins, err := q.LockActivePlatformAdmins(ctx)
		if err != nil {
			return u, err
		}
		if len(admins) <= 1 {
			return u, errLastAdmin
		}
	}
	before := u.Status
	u, err := q.SetSCIMUserStatus(ctx, dbgen.SetSCIMUserStatusParams{ID: u.ID, Status: status})
	if err != nil {
		return u, err
	}
	action := "scim.user_reactivate"
	if !active {
		action = "scim.user_suspend"
		if err := q.DeleteUserSessions(ctx, u.ID); err != nil {
			return u, err
		}
	}
	e := o.entry(action, "user", u.ID.String())
	e.Before, e.After = map[string]any{"status": before}, map[string]any{"status": u.Status}
	return u, audit.Record(ctx, q, e)
}

func (s *Service) lockUser(ctx context.Context, q *dbgen.Queries, id string) (dbgen.User, error) {
	uid, ok := parseID(id)
	if !ok {
		return dbgen.User{}, notFound("User")
	}
	u, err := q.GetSCIMUserForUpdate(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, notFound("User")
	}
	return u, err
}

// ReplaceUser is PUT: every attribute Grounded keeps is replaced; externalId can't change.
func (s *Service) ReplaceUser(ctx context.Context, o Origin, id string, raw []byte) (dbgen.User, error) {
	in, perr := decodeUser(raw)
	if perr != nil {
		return dbgen.User{}, perr
	}
	var out dbgen.User
	err := s.userTx(ctx, o, func(q *dbgen.Queries) error {
		u, err := s.lockUser(ctx, q, id)
		if err != nil {
			return err
		}
		cur := inputOf(u)
		if in.ExternalID == "" {
			in.ExternalID = cur.ExternalID
		} else if in.ExternalID != cur.ExternalID {
			return &Error{Status: http.StatusBadRequest, Type: "mutability", Detail: "externalId can't change: it links the user to their sign-in"}
		}
		if in.Email == "" && !strings.Contains(in.UserName, "@") {
			in.Email = cur.Email
		}
		out, err = s.apply(ctx, q, o, u, in)
		return err
	})
	return out, err
}

// PatchUser is PATCH.
func (s *Service) PatchUser(ctx context.Context, o Origin, id string, raw []byte) (dbgen.User, error) {
	ops, perr := decodePatch(raw)
	if perr != nil {
		return dbgen.User{}, perr
	}
	var out dbgen.User
	err := s.userTx(ctx, o, func(q *dbgen.Queries) error {
		u, err := s.lockUser(ctx, q, id)
		if err != nil {
			return err
		}
		in := inputOf(u)
		if perr := patchUser(&in, ops); perr != nil {
			return perr
		}
		out, err = s.apply(ctx, q, o, u, in)
		return err
	})
	return out, err
}

// DeleteUser suspends the user, takes them out of SCIM groups (the rules follow) and unlinks them: SCIM never deletes a
// person, whose conversations follow retention. A later GET is 404.
func (s *Service) DeleteUser(ctx context.Context, o Origin, id string) error {
	return s.userTx(ctx, o, func(q *dbgen.Queries) error {
		u, err := s.lockUser(ctx, q, id)
		if err != nil {
			return err
		}
		if u, err = s.setActive(ctx, q, o, u, false); err != nil {
			return err
		}
		if _, err := q.RemoveUserFromSCIMGroups(ctx, u.ID); err != nil {
			return err
		}
		if _, err := q.UnlinkSCIMUser(ctx, u.ID); err != nil {
			return err
		}
		if err := ssogroups.Sync(ctx, q, u.ID, ssogroups.Seen{Groups: []string{}, ClaimPresent: true},
			ssogroups.Origin{Trigger: ssogroups.TriggerSCIM, RequestID: o.RequestID, ClientIP: o.ClientIP}); err != nil {
			return err
		}
		e := o.entry("scim.user_unlink", "user", u.ID.String())
		e.Before = userSnapshot(u)
		return audit.Record(ctx, q, e)
	})
}

// GetUser reads a SCIM user.
func (s *Service) GetUser(ctx context.Context, id string) (dbgen.User, error) {
	uid, ok := parseID(id)
	if !ok {
		return dbgen.User{}, notFound("User")
	}
	u, err := dbgen.New(s.Pool).GetSCIMUser(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, notFound("User")
	}
	return u, err
}

// ListUsers is a page of SCIM users, filtered by userName, externalId, emails.value or id.
func (s *Service) ListUsers(ctx context.Context, f *Filter, p Page) ([]dbgen.User, int64, error) {
	var params dbgen.CountSCIMUsersParams
	if f != nil {
		v := f.Value
		switch f.Attr {
		case "username":
			params.UserName = &v
		case "externalid":
			params.ExternalID = &v
		case "emails.value":
			params.Email = &v
		case "id":
			id, ok := parseID(v)
			if !ok {
				return nil, 0, nil
			}
			params.ID = uuid.NullUUID{UUID: id, Valid: true}
		}
	}
	q := dbgen.New(s.Pool)
	total, err := q.CountSCIMUsers(ctx, params)
	if err != nil || p.Count == 0 {
		return nil, total, err
	}
	rows, err := q.ListSCIMUsers(ctx, dbgen.ListSCIMUsersParams{UserName: params.UserName, ExternalID: params.ExternalID, Email: params.Email,
		ID: params.ID, Skip: int32(p.Start - 1), Take: int32(p.Count)})
	return rows, total, err
}
