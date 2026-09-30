package mcpclient

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The registry: platform admins add, change and delete servers; auditors
// read them. Header values are sealed with ENCRYPTION_KEY and never
// returned, logged or audited (only a hint of the last four characters).

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can change MCP servers")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see MCP servers")
	errNoServer  = apperr.NotFound("mcp_server_not_found", "MCP server not found")
	errNoTool    = apperr.NotFound("mcp_tool_not_found", "Tool not found")
	errNameTaken = apperr.Conflict("name_taken", "An MCP server with that name already exists")
	errNoLevel   = apperr.Invalid("invalid_classification", "Choose a classification level that exists")
)

// Server is a registered server as admins see it.
type Server struct {
	dbgen.McpServer
	MaxRank       int32
	ToolCount     int64 // tools the server lists now
	ApprovedCount int64
}

// HasAuth reports whether the server has a stored header.
func (s Server) HasAuth() bool { return s.AuthValueCipher != nil }

// ServerInput creates a server. AuthHeaderName and AuthValue are both
// empty (no credentials) or both set.
type ServerInput struct {
	Name, Description, URL    string
	AuthHeaderName, AuthValue string
	MaxClassification         string
	TimeoutSeconds            int32
	Enabled                   bool
}

// ServerUpdate holds optional changes. AuthHeaderName "" removes the header
// and its value; AuthValue nil keeps the stored value.
type ServerUpdate struct {
	Name, Description, URL    *string
	AuthHeaderName, AuthValue *string
	MaxClassification         *string
	TimeoutSeconds            *int32
	Enabled                   *bool
}

// DefaultTimeoutSeconds is a new server's timeout.
const DefaultTimeoutSeconds = 30

var headerName = regexp.MustCompile("^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$")

// Headers Grounded sets itself, which a server's static header may not
// replace.
var reservedHeaders = map[string]bool{
	"host": true, "content-type": true, "content-length": true, "accept": true, "connection": true,
	"transfer-encoding": true, "mcp-protocol-version": true, "mcp-session-id": true, "mcp-method": true, "mcp-name": true,
	"last-event-id": true, "user-agent": true, "cookie": true,
}

func checkHeader(name, value string) error {
	if !headerName.MatchString(name) || reservedHeaders[strings.ToLower(name)] {
		return apperr.Invalid("invalid_auth_header", "The header name must be a valid HTTP header such as Authorization or X-API-Key")
	}
	if value == "" || len(value) > 4096 || strings.ContainsAny(value, "\r\n\x00") {
		return apperr.Invalid("invalid_auth_value", "The header value must be 1-4096 characters on one line")
	}
	return nil
}

func valueHint(v string) string {
	if len(v) < 8 {
		return ""
	}
	return v[len(v)-4:]
}

func checkFields(name, description string, timeout int32) error {
	if n := len([]rune(strings.TrimSpace(name))); n < 1 || n > 100 {
		return apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if len([]rune(description)) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if timeout < 1 || timeout > 120 {
		return apperr.Invalid("invalid_timeout", "Timeout must be between 1 and 120 seconds")
	}
	return nil
}

func snapshot(s dbgen.McpServer) map[string]any {
	// Never the header value or its ciphertext.
	out := map[string]any{"name": s.Name, "description": s.Description, "url": s.URL, "maxClassification": s.MaxClassification,
		"timeoutSeconds": s.TimeoutSeconds, "enabled": s.Enabled, "hasAuth": s.AuthValueCipher != nil}
	if s.AuthHeaderName != nil {
		out["authHeaderName"] = *s.AuthHeaderName
	}
	return out
}

func by(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

// ListServers lists every server with its tool counts.
func (s *Service) ListServers(ctx context.Context, a authz.Actor) ([]Server, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.ListMCPServers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Server, len(rows))
	for i, r := range rows {
		out[i] = Server{McpServer: dbgen.McpServer{
			ID: r.ID, Name: r.Name, Description: r.Description, URL: r.URL, AuthHeaderName: r.AuthHeaderName,
			AuthValueCipher: r.AuthValueCipher, AuthValueHint: r.AuthValueHint, MaxClassification: r.MaxClassification,
			TimeoutSeconds: r.TimeoutSeconds, Enabled: r.Enabled, ToolsRefreshedAt: r.ToolsRefreshedAt, Revision: r.Revision,
			CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedBy: r.UpdatedBy, UpdatedAt: r.UpdatedAt,
		}, MaxRank: r.MaxRank, ToolCount: r.ToolCount, ApprovedCount: r.ApprovedCount}
	}
	return out, nil
}

// GetServer returns one server.
func (s *Service) GetServer(ctx context.Context, a authz.Actor, id uuid.UUID) (Server, error) {
	if !a.CanReadPlatform() {
		return Server{}, errReadOnly
	}
	return s.server(ctx, id)
}

func (s *Service) server(ctx context.Context, id uuid.UUID) (Server, error) {
	r, err := s.q.GetMCPServer(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Server{}, errNoServer
	} else if err != nil {
		return Server{}, err
	}
	return Server{McpServer: dbgen.McpServer{
		ID: r.ID, Name: r.Name, Description: r.Description, URL: r.URL, AuthHeaderName: r.AuthHeaderName,
		AuthValueCipher: r.AuthValueCipher, AuthValueHint: r.AuthValueHint, MaxClassification: r.MaxClassification,
		TimeoutSeconds: r.TimeoutSeconds, Enabled: r.Enabled, ToolsRefreshedAt: r.ToolsRefreshedAt, Revision: r.Revision,
		CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedBy: r.UpdatedBy, UpdatedAt: r.UpdatedAt,
	}, MaxRank: r.MaxRank, ToolCount: r.ToolCount, ApprovedCount: r.ApprovedCount}, nil
}

// CreateServer registers a server (platform admins). Audited as
// mcp_server.create.
func (s *Service) CreateServer(ctx context.Context, a authz.Actor, in ServerInput) (Server, error) {
	if !a.IsPlatformAdmin() {
		return Server{}, errAdminOnly
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.TimeoutSeconds == 0 {
		in.TimeoutSeconds = DefaultTimeoutSeconds
	}
	if err := checkFields(in.Name, in.Description, in.TimeoutSeconds); err != nil {
		return Server{}, err
	}
	u, err := NormalizeURL(in.URL, s.AllowPrivate)
	if err != nil {
		return Server{}, err
	}
	id := uuid.New()
	p := dbgen.InsertMCPServerParams{ID: id, Name: in.Name, Description: in.Description, URL: u,
		MaxClassification: in.MaxClassification, TimeoutSeconds: in.TimeoutSeconds, Enabled: in.Enabled, CreatedBy: by(a)}
	if in.AuthHeaderName != "" || in.AuthValue != "" {
		if err := checkHeader(in.AuthHeaderName, in.AuthValue); err != nil {
			return Server{}, err
		}
		if p.AuthValueCipher, err = s.box.Seal([]byte(in.AuthValue), ServerAAD(id)); err != nil {
			return Server{}, err
		}
		p.AuthHeaderName, p.AuthValueHint = &in.AuthHeaderName, valueHint(in.AuthValue)
	}
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		row, err := q.InsertMCPServer(ctx, p)
		if err := writeErr(err); err != nil {
			return err
		}
		e := a.Audit("mcp_server.create", "mcp_server", id.String())
		e.After = snapshot(row)
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Server{}, err
	}
	return s.server(ctx, id)
}

// writeErr maps constraint violations of a server write.
func writeErr(err error) error {
	switch {
	case err == nil:
		return nil
	case apperr.IsUniqueViolation(err, "mcp_servers_name_key"):
		return errNameTaken
	case apperr.IsForeignKeyViolation(err, ""):
		return errNoLevel
	}
	return err
}

// UpdateServer changes a server (platform admins). Audited as
// mcp_server.update, with whether the header value changed.
func (s *Service) UpdateServer(ctx context.Context, a authz.Actor, id uuid.UUID, in ServerUpdate, expectedRevision int64) (Server, error) {
	if !a.IsPlatformAdmin() {
		return Server{}, errAdminOnly
	}
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockMCPServer(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoServer
		} else if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		p, valueChanged, err := s.applyUpdate(cur, in)
		if err != nil {
			return err
		}
		p.UpdatedBy = by(a)
		row, err := q.UpdateMCPServer(ctx, p)
		if err := writeErr(err); err != nil {
			return err
		}
		e := a.Audit("mcp_server.update", "mcp_server", id.String())
		e.Before, e.After = snapshot(cur), snapshot(row)
		e.Metadata = map[string]any{"authValueChanged": valueChanged}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Server{}, err
	}
	return s.server(ctx, id)
}

// applyUpdate applies and checks the changes.
func (s *Service) applyUpdate(cur dbgen.McpServer, in ServerUpdate) (dbgen.UpdateMCPServerParams, bool, error) {
	p := dbgen.UpdateMCPServerParams{ID: cur.ID, Name: cur.Name, Description: cur.Description, URL: cur.URL,
		AuthHeaderName: cur.AuthHeaderName, AuthValueCipher: cur.AuthValueCipher, AuthValueHint: cur.AuthValueHint,
		MaxClassification: cur.MaxClassification, TimeoutSeconds: cur.TimeoutSeconds, Enabled: cur.Enabled, UpdatedBy: cur.UpdatedBy}
	setIf(&p.Name, in.Name)
	p.Name = strings.TrimSpace(p.Name)
	setIf(&p.Description, in.Description)
	setIf(&p.MaxClassification, in.MaxClassification)
	setIf(&p.TimeoutSeconds, in.TimeoutSeconds)
	setIf(&p.Enabled, in.Enabled)
	if err := checkFields(p.Name, p.Description, p.TimeoutSeconds); err != nil {
		return p, false, err
	}
	if in.URL != nil {
		u, err := NormalizeURL(*in.URL, s.AllowPrivate)
		if err != nil {
			return p, false, err
		}
		p.URL = u
	}
	return p, in.AuthValue != nil || (in.AuthHeaderName != nil && *in.AuthHeaderName == ""), s.applyAuth(&p, cur, in)
}

// applyAuth applies a header change: "" removes it; a new name keeps the
// stored value unless a new one is given.
func (s *Service) applyAuth(p *dbgen.UpdateMCPServerParams, cur dbgen.McpServer, in ServerUpdate) error {
	if in.AuthHeaderName != nil && *in.AuthHeaderName == "" {
		p.AuthHeaderName, p.AuthValueCipher, p.AuthValueHint = nil, nil, ""
		return nil
	}
	name := ""
	if cur.AuthHeaderName != nil {
		name = *cur.AuthHeaderName
	}
	setIf(&name, in.AuthHeaderName)
	if in.AuthValue == nil {
		if in.AuthHeaderName == nil {
			return nil
		}
		if cur.AuthValueCipher == nil {
			return apperr.Invalid("invalid_auth_value", "Enter the header's value")
		}
		if err := checkHeader(name, "x"); err != nil {
			return err
		}
		p.AuthHeaderName = &name
		return nil
	}
	if err := checkHeader(name, *in.AuthValue); err != nil {
		return err
	}
	ct, err := s.box.Seal([]byte(*in.AuthValue), ServerAAD(cur.ID))
	if err != nil {
		return err
	}
	p.AuthHeaderName, p.AuthValueCipher, p.AuthValueHint = &name, ct, valueHint(*in.AuthValue)
	return nil
}

func setIf[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}

// InUse is an agent whose published version uses a server's tool.
type InUse = dbgen.MCPServerPublishedUsesRow

// DeleteServer removes a server and its tools (platform admins). While a
// published (current) agent version uses one of its tools it is refused
// (409 mcp_server_in_use, details.agents): disable the server instead, or
// publish those agents without the tool. Past versions lose the tool.
// Audited as mcp_server.delete.
func (s *Service) DeleteServer(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockMCPServer(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoServer
		} else if err != nil {
			return err
		}
		uses, err := q.MCPServerPublishedUses(ctx, id)
		if err != nil {
			return err
		}
		if len(uses) > 0 {
			agents := make([]map[string]any, len(uses))
			for i, u := range uses {
				agents[i] = map[string]any{"id": u.ID, "name": u.Name, "teamSlug": u.TeamSlug, "teamName": u.TeamName,
					"version": u.Version}
			}
			e := apperr.Conflict("mcp_server_in_use", "Published agents use this server's tools. Disable the server instead, "+
				"or publish those agents without its tools first.")
			e.Details = map[string]any{"agents": agents}
			return e
		}
		if err := q.DeleteMCPServer(ctx, id); err != nil {
			return err
		}
		e := a.Audit("mcp_server.delete", "mcp_server", id.String())
		e.Before = snapshot(cur)
		return audit.Record(ctx, q, e)
	})
}

// target reads how to reach a server, decrypting its header value.
func (s *Service) target(sv dbgen.McpServer) (target, error) {
	t := target{name: sv.Name, url: sv.URL, timeout: time.Duration(sv.TimeoutSeconds) * time.Second}
	if sv.AuthHeaderName != nil && sv.AuthValueCipher != nil {
		plain, err := s.box.Open(sv.AuthValueCipher, ServerAAD(sv.ID))
		if err != nil {
			return t, &Error{Class: ClassConfig,
				Message: "The stored header value can't be decrypted with the current ENCRYPTION_KEY. Enter it again."}
		}
		t.headerName, t.headerValue = *sv.AuthHeaderName, string(plain)
	}
	return t, nil
}
