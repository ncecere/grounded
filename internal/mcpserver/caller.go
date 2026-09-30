// Package mcpserver is Grounded as an MCP server (docs/v0.3.0.md §3,
// docs/mcp.md): two tools, search and ask, over the Model Context Protocol,
// served statelessly at POST /mcp (internal/httpapi mounts it).
//
// Every request builds its own server for its caller: the tools' argument
// enums list exactly the knowledge bases and agents the caller may use, so
// a list is private to the caller. The tools call the same services as the
// REST API, so classification, key restrictions, query limits, budgets and
// usage apply unchanged; usage is recorded with the channel mcp and every
// call is audited (mcp.search, mcp.ask) without its content.
package mcpserver

import (
	"slices"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
)

// Caller is who is calling /mcp. In v0.3 it is an API key with the mcp
// scope (KeyCaller); an OAuth access token acting as a signed-in person
// (docs/v0.3.0.md §3, milestone M5) will be another implementation.
type Caller interface {
	// Actor is the principal the tools act as: the services apply its
	// team, its lists, its limits and its budget.
	Actor() authz.Actor
	// Binding identifies the credential that conversation handles are bound
	// to: a handle minted for one credential is refused for any other.
	Binding() uuid.UUID
	// Stateless reports a caller whose conversations aren't kept (service
	// keys): ask returns no conversation handle for it.
	Stateless() bool
}

// KeyCaller is an API key with the mcp scope.
type KeyCaller struct{ actor authz.Actor }

// NewKeyCaller returns the caller for an API-key actor that has the mcp
// scope (the HTTP layer checks it). Through MCP the key acts with the
// query scope only: the tools search and ask, and never ingest or manage,
// whatever else the key may do on the REST API.
func NewKeyCaller(a authz.Actor) KeyCaller {
	grant := *a.Key
	grant.Scopes = []string{authz.ScopeQuery}
	grant.KBIDs, grant.AgentIDs = slices.Clone(a.Key.KBIDs), slices.Clone(a.Key.AgentIDs)
	a.Key = &grant
	return KeyCaller{actor: a}
}

func (c KeyCaller) Actor() authz.Actor { return c.actor }
func (c KeyCaller) Binding() uuid.UUID { return c.actor.Key.ID }
func (c KeyCaller) Stateless() bool    { return !c.actor.Key.Personal() }
