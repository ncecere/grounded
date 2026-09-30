// Package catalog manages model connections (OpenAI-compatible proxies),
// the models admins add from them, and embedding profiles (ADR-0005,
// ADR-0007). Proxy API keys are stored encrypted and never returned.
package catalog

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can do this")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
	errNoConn    = apperr.NotFound("connection_not_found", "Model connection not found")
)

type Service struct {
	pool *pgxpool.Pool
	q    *dbgen.Queries
	box  *secrets.Box
	// Pacer enforces connections' requestsPerMinute across processes (nil:
	// no limits are enforced).
	Pacer *ratelimit.Pacer
	Log   *slog.Logger
}

func NewService(pool *pgxpool.Pool, box *secrets.Box) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), box: box}
}

func notFound(err error, e *apperr.Error) error {
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return e
	}
	return err
}

func trimmedLen(s string, min, max int, code, msg string) error {
	if n := len(strings.TrimSpace(s)); n < min || n > max {
		return apperr.Invalid(code, msg)
	}
	return nil
}

// ---- Connections -----------------------------------------------------------

// Connection is a proxy connection with its model count.
type Connection struct {
	dbgen.ModelConnection
	ModelCount int64
}

// ConnectionInput creates a connection. RequestsPerMinute 0 = unlimited;
// MaxConcurrentRequests 0 = the default (8).
type ConnectionInput struct {
	Name, Description, BaseURL, APIKey string
	TimeoutSeconds                     int32
	RequestsPerMinute                  int32
	MaxConcurrentRequests              int32
	Enabled                            bool
}

// ConnectionUpdate holds optional changes. APIKey: nil keeps the stored key,
// "" removes it, anything else replaces it. RequestsPerMinute: nil keeps, 0
// removes the limit.
type ConnectionUpdate struct {
	Name, Description, BaseURL, APIKey *string
	TimeoutSeconds                     *int32
	RequestsPerMinute                  *int32
	MaxConcurrentRequests              *int32
	Enabled                            *bool
}

// DefaultMaxConcurrentRequests is a connection's default cap on requests
// in flight at once (ADR-0020: GPUs serialise). Only SystemOne calls
// apply it so far.
const DefaultMaxConcurrentRequests = 8

func checkConcurrency(n int32) error {
	if n < 1 || n > 256 {
		return apperr.Invalid("invalid_max_concurrent_requests", "Maximum concurrent requests must be between 1 and 256")
	}
	return nil
}

// rpmColumn stores a requests-per-minute setting (0 = unlimited = NULL).
func rpmColumn(n int32) (*int32, error) {
	if n < 0 || n > 1_000_000 {
		return nil, apperr.Invalid("invalid_requests_per_minute", "Requests per minute must be between 0 (unlimited) and 1,000,000")
	}
	if n == 0 {
		return nil, nil
	}
	return &n, nil
}

// NormalizeBaseURL validates an OpenAI-style base URL and strips any
// trailing slash. Proxies are admin-configured and usually internal, so
// private addresses are allowed.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(raw) > 500 {
		return "", apperr.Invalid("invalid_base_url", "Base URL must be an http(s) URL such as https://proxy.example.edu/v1")
	}
	return raw, nil
}

func keyHint(key string) string {
	if len(key) < 8 {
		return ""
	}
	return key[len(key)-4:]
}

// ConnectionAAD binds a connection's stored API key ciphertext to its row
// (also used by key rotation, internal/keyrotation).
func ConnectionAAD(id uuid.UUID) []byte { return []byte("model_connection:" + id.String()) }

func (s *Service) sealKey(id uuid.UUID, key string) ([]byte, string, error) {
	if key == "" {
		return nil, "", nil
	}
	if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return nil, "", apperr.Invalid("invalid_api_key", "API key is not valid")
	}
	ct, err := s.box.Seal([]byte(key), ConnectionAAD(id))
	return ct, keyHint(key), err
}

func connSnapshot(c dbgen.ModelConnection) map[string]any {
	// Never include the key or ciphertext.
	return map[string]any{
		"name": c.Name, "description": c.Description, "baseUrl": c.BaseURL,
		"hasApiKey": c.ApiKeyCiphertext != nil, "timeoutSeconds": c.TimeoutSeconds, "enabled": c.Enabled,
		"requestsPerMinute": c.RequestsPerMinute, "maxConcurrentRequests": c.MaxConcurrentRequests,
	}
}

func (s *Service) ListConnections(ctx context.Context, a authz.Actor) ([]Connection, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.ListConnections(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Connection, len(rows))
	for i, r := range rows {
		out[i] = Connection{ModelConnection: dbgen.ModelConnection{
			ID: r.ID, Name: r.Name, Description: r.Description, BaseURL: r.BaseURL,
			ApiKeyCiphertext: r.ApiKeyCiphertext, ApiKeyHint: r.ApiKeyHint, TimeoutSeconds: r.TimeoutSeconds,
			RequestsPerMinute: r.RequestsPerMinute, MaxConcurrentRequests: r.MaxConcurrentRequests, Enabled: r.Enabled, Revision: r.Revision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		}, ModelCount: r.ModelCount}
	}
	return out, nil
}

func (s *Service) GetConnection(ctx context.Context, a authz.Actor, id uuid.UUID) (Connection, error) {
	if !a.CanReadPlatform() {
		return Connection{}, errReadOnly
	}
	c, err := s.q.GetConnection(ctx, id)
	if err != nil {
		return Connection{}, notFound(err, errNoConn)
	}
	n, err := s.q.CountConnectionModels(ctx, id)
	return Connection{ModelConnection: c, ModelCount: n}, err
}

func validateConnection(name, description string, timeout int32) error {
	if err := trimmedLen(name, 1, 100, "invalid_name", "Name must be 1-100 characters"); err != nil {
		return err
	}
	if len(description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if timeout < 1 || timeout > 600 {
		return apperr.Invalid("invalid_timeout", "Timeout must be between 1 and 600 seconds")
	}
	return nil
}

func (s *Service) CreateConnection(ctx context.Context, a authz.Actor, in ConnectionInput) (Connection, error) {
	if !a.IsPlatformAdmin() {
		return Connection{}, errAdminOnly
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.TimeoutSeconds == 0 {
		in.TimeoutSeconds = 60
	}
	if err := validateConnection(in.Name, in.Description, in.TimeoutSeconds); err != nil {
		return Connection{}, err
	}
	base, err := NormalizeBaseURL(in.BaseURL)
	if err != nil {
		return Connection{}, err
	}
	rpm, err := rpmColumn(in.RequestsPerMinute)
	if err != nil {
		return Connection{}, err
	}
	if in.MaxConcurrentRequests == 0 {
		in.MaxConcurrentRequests = DefaultMaxConcurrentRequests
	}
	if err := checkConcurrency(in.MaxConcurrentRequests); err != nil {
		return Connection{}, err
	}
	id := uuid.New()
	ct, hint, err := s.sealKey(id, in.APIKey)
	if err != nil {
		return Connection{}, err
	}
	var out dbgen.ModelConnection
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		out, err = q.InsertConnection(ctx, dbgen.InsertConnectionParams{
			ID: id, Name: in.Name, Description: in.Description, BaseURL: base,
			ApiKeyCiphertext: ct, ApiKeyHint: hint, TimeoutSeconds: in.TimeoutSeconds, Enabled: in.Enabled,
			RequestsPerMinute: rpm, MaxConcurrentRequests: in.MaxConcurrentRequests, CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		if apperr.IsUniqueViolation(err, "model_connections_name_key") {
			return apperr.Conflict("name_taken", "A connection with that name already exists")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.connection_create", "model_connection", id.String())
		e.After = connSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return Connection{ModelConnection: out}, err
}

func (s *Service) UpdateConnection(ctx context.Context, a authz.Actor, id uuid.UUID, in ConnectionUpdate, expectedRevision int64) (Connection, error) {
	if !a.IsPlatformAdmin() {
		return Connection{}, errAdminOnly
	}
	var out Connection
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockConnection(ctx, id)
		if err != nil {
			return notFound(err, errNoConn)
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		p := dbgen.UpdateConnectionParams{
			ID: id, Name: cur.Name, Description: cur.Description, BaseURL: cur.BaseURL,
			ApiKeyCiphertext: cur.ApiKeyCiphertext, ApiKeyHint: cur.ApiKeyHint,
			TimeoutSeconds: cur.TimeoutSeconds, Enabled: cur.Enabled, RequestsPerMinute: cur.RequestsPerMinute,
			MaxConcurrentRequests: cur.MaxConcurrentRequests,
		}
		if err := applyConnectionUpdate(&p, in); err != nil {
			return err
		}
		keyChanged := in.APIKey != nil
		if keyChanged {
			if p.ApiKeyCiphertext, p.ApiKeyHint, err = s.sealKey(id, *in.APIKey); err != nil {
				return err
			}
		}
		updated, err := q.UpdateConnection(ctx, p)
		if apperr.IsUniqueViolation(err, "model_connections_name_key") {
			return apperr.Conflict("name_taken", "A connection with that name already exists")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.connection_update", "model_connection", id.String())
		e.Before, e.After = connSnapshot(cur), connSnapshot(updated)
		e.Metadata = map[string]any{"apiKeyChanged": keyChanged}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		n, err := q.CountConnectionModels(ctx, id)
		out = Connection{ModelConnection: updated, ModelCount: n}
		return err
	})
	return out, err
}

// applyConnectionUpdate applies and checks the changes to a connection's
// fields (not its key).
func applyConnectionUpdate(p *dbgen.UpdateConnectionParams, in ConnectionUpdate) error {
	var err error
	if in.Name != nil {
		p.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		p.Description = *in.Description
	}
	if in.TimeoutSeconds != nil {
		p.TimeoutSeconds = *in.TimeoutSeconds
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if in.RequestsPerMinute != nil {
		if p.RequestsPerMinute, err = rpmColumn(*in.RequestsPerMinute); err != nil {
			return err
		}
	}
	if in.MaxConcurrentRequests != nil {
		if err := checkConcurrency(*in.MaxConcurrentRequests); err != nil {
			return err
		}
		p.MaxConcurrentRequests = *in.MaxConcurrentRequests
	}
	if err := validateConnection(p.Name, p.Description, p.TimeoutSeconds); err != nil {
		return err
	}
	if in.BaseURL != nil {
		if p.BaseURL, err = NormalizeBaseURL(*in.BaseURL); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) DeleteConnection(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockConnection(ctx, id)
		if err != nil {
			return notFound(err, errNoConn)
		}
		if err := q.DeleteConnection(ctx, id); apperr.IsForeignKeyViolation(err, "") {
			return apperr.Conflict("connection_in_use", "Remove this connection's models first")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.connection_delete", "model_connection", id.String())
		e.Before = connSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}

// client builds a gateway client for a stored connection.
func (s *Service) client(c dbgen.ModelConnection) (*gateway.Client, error) {
	key := ""
	if c.ApiKeyCiphertext != nil {
		plain, err := s.box.Open(c.ApiKeyCiphertext, ConnectionAAD(c.ID))
		if err != nil {
			return nil, apperr.Conflict("api_key_undecryptable",
				"The stored API key cannot be decrypted with the current ENCRYPTION_KEY. Enter the key again.")
		}
		key = string(plain)
	}
	cl := gateway.New(c.BaseURL, key, time.Duration(c.TimeoutSeconds)*time.Second)
	if c.RequestsPerMinute != nil && *c.RequestsPerMinute > 0 && s.Pacer != nil {
		cl.Limiter = &connLimiter{pacer: s.Pacer, key: "conn:" + c.ID.String(), rpm: int(*c.RequestsPerMinute), log: s.Log}
	}
	return cl, nil
}

// observedClient is client with request metrics labelled with the
// connection's name and the model kind (grounded_model_requests_total).
// Admin tests and doctor probes use client and are not counted.
func (s *Service) observedClient(c dbgen.ModelConnection, kind string) (*gateway.Client, error) {
	cl, err := s.client(c)
	if err != nil {
		return nil, err
	}
	cl.Observe = observability.ModelObserver(c.Name, kind)
	return cl, nil
}
