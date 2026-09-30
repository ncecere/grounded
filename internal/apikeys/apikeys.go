// Package apikeys issues and verifies team API keys (ADR-0012).
//
// A key looks like rag_<12 id chars>_<40 secret chars>. The id part is stored
// in clear for lookup; only HMAC-SHA256(pepper, key) is stored, so a database
// leak does not reveal usable keys. Personal keys belong to a membership and
// are revoked when the member leaves; service keys belong to the team.
//
// Pepper rotation (docs/operations/rotate-keys.md): with
// API_KEY_PEPPER_PREVIOUS set, a key whose digest was made with the previous
// pepper still authenticates and is re-hashed with the current pepper on
// that use; every digest records its pepper's id (pepper_id).
package apikeys

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"math/big"
	"slices"
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
	"github.com/ncecere/grounded/internal/teams"
)

const (
	KindPersonal = "personal"
	KindService  = "service"

	keyPrefix = "rag_"
	idLen     = 12
	secretLen = 40
	alphabet  = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
)

type Service struct {
	Pool  *pgxpool.Pool
	Teams *teams.Service
	// PreviousPepper is API_KEY_PEPPER_PREVIOUS (nil: no rotation).
	PreviousPepper []byte
	pepper         []byte
	q              *dbgen.Queries
}

func New(pool *pgxpool.Pool, t *teams.Service, pepper []byte) *Service {
	return &Service{Pool: pool, Teams: t, pepper: pepper, q: dbgen.New(pool)}
}

func (s *Service) peppers() secrets.Peppers { return secrets.NewPeppers(s.pepper, s.PreviousPepper) }

func randomString(n int) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err) // crypto/rand never fails on supported platforms
		}
		b[i] = alphabet[v.Int64()]
	}
	return string(b)
}

func (s *Service) hash(key string) []byte { return digest(key)(s.pepper) }

// digest is a key's stored digest under a pepper: HMAC-SHA256(pepper, key).
func digest(key string) func(pepper []byte) []byte {
	return func(pepper []byte) []byte {
		m := hmac.New(sha256.New, pepper)
		m.Write([]byte(key))
		return m.Sum(nil)
	}
}

// CreateInput describes a new key.
type CreateInput struct {
	Name   string
	Kind   string
	Scopes []string
	KBIDs  []uuid.UUID
	// AgentIDs restricts the key to agents of the team (DESIGN.md §3.3);
	// empty = every agent.
	AgentIDs  []uuid.UUID
	ExpiresAt *time.Time
	// ResponsibleUserID is a service key's responsible contact, a member of
	// the team (default: the creator). Personal keys belong to the creator.
	ResponsibleUserID *uuid.UUID
}

// Listed is a key with its owner's (personal) or responsible contact's
// (service) name and email.
type Listed = dbgen.ListTeamAPIKeysRow

// Created is a new key; Secret is shown once and never stored.
type Created struct {
	Key    dbgen.APIKey
	Secret string
}

func keySnapshot(k dbgen.APIKey) map[string]any {
	return map[string]any{"name": k.Name, "kind": k.Kind, "prefix": k.Prefix, "scopes": k.Scopes, "kbIds": k.KBIDs,
		"agentIds": k.AgentIDs, "userId": k.UserID, "expiresAt": k.ExpiresAt}
}

func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in CreateInput) (Created, error) {
	if a.Key != nil {
		return Created{}, apperr.Forbidden("API keys cannot create API keys")
	}
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return Created{}, err
	}
	if acc.Role == "" {
		return Created{}, apperr.NotFound("team_not_found", "Team not found")
	}
	if acc.Team.Status != teams.StatusActive {
		return Created{}, apperr.Conflict("team_archived", "This team is archived and read-only")
	}
	in.Name = strings.TrimSpace(in.Name)
	if n := len(in.Name); n < 1 || n > 100 {
		return Created{}, apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if in.Kind == "" {
		in.Kind = KindPersonal
	}
	var allowed []string
	switch in.Kind {
	case KindPersonal:
		allowed = authz.MaxScopesForRole(acc.Role)
	case KindService:
		if !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
			return Created{}, apperr.Forbidden("Only team admins and owners can create service keys")
		}
		allowed = authz.MaxScopesForRole(authz.RoleAdmin)
	default:
		return Created{}, apperr.Invalid("invalid_kind", "Kind must be personal or service")
	}
	if len(in.Scopes) == 0 {
		return Created{}, apperr.Invalid("invalid_scopes", "Choose at least one scope")
	}
	slices.Sort(in.Scopes)
	in.Scopes = slices.Compact(in.Scopes)
	for _, sc := range in.Scopes {
		if !slices.Contains(allowed, sc) {
			return Created{}, apperr.Forbidden("Your team role does not allow the " + sc + " scope")
		}
	}
	if in.ExpiresAt != nil && !in.ExpiresAt.After(time.Now()) {
		return Created{}, apperr.Invalid("invalid_expiry", "The expiry must be in the future")
	}
	if len(in.AgentIDs) == 0 {
		in.AgentIDs = nil // every agent
	} else {
		slices.SortFunc(in.AgentIDs, func(x, y uuid.UUID) int { return strings.Compare(x.String(), y.String()) })
		in.AgentIDs = slices.Compact(in.AgentIDs)
	}
	secret := keyPrefix + randomString(idLen) + "_" + randomString(secretLen)
	var out dbgen.APIKey
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := checkRestrictions(ctx, q, acc.Team.ID, in); err != nil {
			return err
		}
		contact, err := responsibleContact(ctx, q, a, acc.Team.ID, in)
		if err != nil {
			return err
		}
		out, err = q.InsertAPIKey(ctx, dbgen.InsertAPIKeyParams{
			TeamID: acc.Team.ID, Kind: in.Kind, UserID: uuid.NullUUID{UUID: contact, Valid: true},
			Name: in.Name, Prefix: secret[:len(keyPrefix)+idLen], SecretHash: s.hash(secret), PepperID: s.peppers().CurrentID(),
			Scopes: in.Scopes, KBIDs: in.KBIDs, AgentIDs: in.AgentIDs, ExpiresAt: in.ExpiresAt,
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		if err != nil {
			return err
		}
		e := a.Audit("apikey.create", "api_key", out.ID.String())
		e.TeamID, e.After = acc.Team.ID, keySnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return Created{Key: out, Secret: secret}, err
}

// checkRestrictions checks that the KBs and agents a key is restricted to
// belong to the team.
func checkRestrictions(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, in CreateInput) error {
	for _, kb := range in.KBIDs {
		k, err := q.GetKB(ctx, kb)
		if err != nil || k.TeamID != teamID {
			return apperr.Invalid("unknown_kb", "Every knowledge base must belong to this team")
		}
	}
	for _, id := range in.AgentIDs {
		ag, err := q.GetAgent(ctx, id)
		if err != nil || ag.TeamID != teamID {
			return apperr.Invalid("unknown_agent", "Every agent must belong to this team")
		}
	}
	return nil
}

// responsibleContact is who a new key belongs to: the creator for personal
// keys; for service keys the chosen responsible contact, an active member
// of the team (DESIGN.md §3.3), or the creator.
func responsibleContact(ctx context.Context, q *dbgen.Queries, a authz.Actor, teamID uuid.UUID, in CreateInput) (uuid.UUID, error) {
	if in.ResponsibleUserID == nil || *in.ResponsibleUserID == a.UserID {
		return a.UserID, nil
	}
	if in.Kind != KindService {
		return uuid.Nil, apperr.Invalid("invalid_contact", "Only service keys have a responsible contact; a personal key is yours")
	}
	ok, err := q.IsTeamMember(ctx, dbgen.IsTeamMemberParams{TeamID: teamID, UserID: *in.ResponsibleUserID})
	if err != nil {
		return uuid.Nil, err
	}
	if !ok {
		return uuid.Nil, apperr.Invalid("invalid_contact", "The responsible contact must be an active member of this team")
	}
	return *in.ResponsibleUserID, nil
}

// List returns active keys: team admins see every key; others see their own
// personal keys.
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string) ([]Listed, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return nil, err
	}
	if acc.Role == "" || a.Key != nil {
		return nil, apperr.NotFound("team_not_found", "Team not found")
	}
	p := dbgen.ListTeamAPIKeysParams{TeamID: acc.Team.ID}
	if !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
		p.UserID = uuid.NullUUID{UUID: a.UserID, Valid: true}
	}
	return s.q.ListTeamAPIKeys(ctx, p)
}

// Get returns one of the team's keys, including a revoked one (links from
// the audit log outlive the key). Like List: team admins see every key;
// others their own personal keys, and any other key is not found.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Listed, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return Listed{}, err
	}
	if acc.Role == "" || a.Key != nil {
		return Listed{}, apperr.NotFound("team_not_found", "Team not found")
	}
	row, err := s.q.GetTeamAPIKey(ctx, dbgen.GetTeamAPIKeyParams{ID: id, TeamID: acc.Team.ID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Listed{}, apperr.NotFound("key_not_found", "API key not found")
	} else if err != nil {
		return Listed{}, err
	}
	k := row.APIKey
	own := k.Kind == KindPersonal && k.UserID.Valid && k.UserID.UUID == a.UserID
	if !own && !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
		return Listed{}, apperr.NotFound("key_not_found", "API key not found")
	}
	return Listed{APIKey: k, UserEmail: row.UserEmail, UserName: row.UserName}, nil
}

// Revoke disables a key. Owners of personal keys and team admins may revoke.
func (s *Service) Revoke(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return err
	}
	if acc.Role == "" || a.Key != nil {
		return apperr.NotFound("team_not_found", "Team not found")
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		k, err := q.GetAPIKey(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (k.TeamID != acc.Team.ID || k.RevokedAt != nil)) {
			return apperr.NotFound("key_not_found", "API key not found")
		} else if err != nil {
			return err
		}
		own := k.Kind == KindPersonal && k.UserID.Valid && k.UserID.UUID == a.UserID
		if !own && !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
			return apperr.Forbidden("Only the key's owner or a team admin can revoke it")
		}
		if err := q.RevokeAPIKey(ctx, id); err != nil {
			return err
		}
		e := a.Audit("apikey.revoke", "api_key", id.String())
		e.TeamID, e.Before = acc.Team.ID, keySnapshot(k)
		return audit.Record(ctx, q, e)
	})
}

// SetContact reassigns a service key's responsible contact to an active
// member of the team (team admins and owners, DESIGN.md §3.3).
func (s *Service) SetContact(ctx context.Context, a authz.Actor, teamRef string, id, userID uuid.UUID) (dbgen.APIKey, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return dbgen.APIKey{}, err
	}
	if acc.Role == "" || a.Key != nil {
		return dbgen.APIKey{}, apperr.NotFound("team_not_found", "Team not found")
	}
	if !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
		return dbgen.APIKey{}, apperr.Forbidden("Only team admins and owners can change a service key's contact")
	}
	var out dbgen.APIKey
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		k, err := q.GetAPIKey(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (k.TeamID != acc.Team.ID || k.RevokedAt != nil)) {
			return apperr.NotFound("key_not_found", "API key not found")
		} else if err != nil {
			return err
		}
		if k.Kind != KindService {
			return apperr.Invalid("invalid_contact", "Only service keys have a responsible contact")
		}
		contact, err := responsibleContact(ctx, q, a, acc.Team.ID, CreateInput{Kind: KindService, ResponsibleUserID: &userID})
		if err != nil {
			return err
		}
		if out, err = q.SetAPIKeyContact(ctx, dbgen.SetAPIKeyContactParams{ID: id, UserID: uuid.NullUUID{UUID: contact, Valid: true}}); err != nil {
			return err
		}
		e := a.Audit("apikey.contact_change", "api_key", id.String())
		e.TeamID, e.Before, e.After = acc.Team.ID, keySnapshot(k), keySnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// markPepper finishes a key's pepper rotation on use: a digest made with
// the previous pepper is replaced by one under the current pepper (audited,
// once per key), and a digest from before pepper ids is labelled with the
// current pepper's id.
func (s *Service) markPepper(ctx context.Context, k dbgen.APIKey, p secrets.Peppers, match secrets.PepperMatch, rehash []byte) error {
	cur := p.CurrentID()
	if match != secrets.MatchPrevious {
		if bytes.Equal(k.PepperID, cur) {
			return nil
		}
		_, err := s.q.RehashAPIKey(ctx, dbgen.RehashAPIKeyParams{ID: k.ID, SecretHash: k.SecretHash, PepperID: cur, OldHash: k.SecretHash})
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		n, err := q.RehashAPIKey(ctx, dbgen.RehashAPIKeyParams{ID: k.ID, SecretHash: rehash, PepperID: cur, OldHash: k.SecretHash})
		if err != nil || n == 0 {
			return err // n == 0: a concurrent request re-hashed it
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorKind: audit.ActorSystem, TeamID: k.TeamID, Action: "apikey.pepper_rehash", TargetType: "api_key", TargetID: k.ID.String(),
		})
	})
}

// ErrInvalidKey is returned for unknown, revoked, expired or orphaned keys.
var ErrInvalidKey = errors.New("invalid API key")

// Authenticate verifies a presented key and returns the principal it acts
// as, and records the key as used (Verify, then Touch).
func (s *Service) Authenticate(ctx context.Context, presented string) (authz.Actor, error) {
	actor, err := s.Verify(ctx, presented)
	if err == nil {
		s.Touch(ctx, actor.Key.ID)
	}
	return actor, err
}

// Touch records that a key was used ("Last used"). Callers that may still
// refuse the request (a missing scope) call it only once they accept it.
func (s *Service) Touch(ctx context.Context, id uuid.UUID) { _ = s.q.TouchAPIKey(ctx, id) }

// Verify verifies a presented key and returns the principal it acts as,
// without recording a use. Personal keys stop working when their owner
// leaves the team or is suspended, even before revocation is recorded.
func (s *Service) Verify(ctx context.Context, presented string) (authz.Actor, error) {
	if len(presented) != len(keyPrefix)+idLen+1+secretLen || !strings.HasPrefix(presented, keyPrefix) {
		return authz.Actor{}, ErrInvalidKey
	}
	row, err := s.q.GetAPIKeyByPrefix(ctx, presented[:len(keyPrefix)+idLen])
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return authz.Actor{}, ErrInvalidKey
	} else if err != nil {
		return authz.Actor{}, err
	}
	k := row.APIKey
	peppers := s.peppers()
	match, rehash := peppers.Verify(k.SecretHash, digest(presented))
	if match == secrets.NoMatch || k.RevokedAt != nil || (k.ExpiresAt != nil && !k.ExpiresAt.After(time.Now())) {
		return authz.Actor{}, ErrInvalidKey
	}
	if k.Kind == KindPersonal {
		ok, err := s.q.IsTeamMember(ctx, dbgen.IsTeamMemberParams{TeamID: k.TeamID, UserID: k.UserID.UUID})
		if err != nil {
			return authz.Actor{}, err
		}
		if !k.UserID.Valid || !ok {
			return authz.Actor{}, ErrInvalidKey
		}
	}
	if err := s.markPepper(ctx, k, peppers, match, rehash); err != nil {
		return authz.Actor{}, err
	}
	return authz.Actor{
		UserID: k.UserID.UUID,
		Key:    &authz.KeyGrant{ID: k.ID, TeamID: k.TeamID, Scopes: k.Scopes, KBIDs: k.KBIDs, AgentIDs: k.AgentIDs, Kind: k.Kind},
	}, nil
}
