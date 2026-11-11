// Package connector is the contract between a source connector and Grounded (ADR-0035, #258).
//
// A connector is a package that registers a source type and implements Connector: validate its settings, check a
// credential, and sync. A sync lists what changed in the provider and hands each item to a Sink. The runtime
// (internal/sourcesync) owns everything else: stored credentials, scheduling, limits, throttling, safe deletion,
// document permissions and the way into parsing, chunking and embedding. A connector never touches the database.
//
// Rules for a connector:
//
//   - An item's ID is stable for the life of the item in the provider: a rename or a move keeps it.
//   - Version changes whenever the content changes (an ETag, a revision, a modified time). The sink asks for the content
//     only when the version differs from the stored one, so an unchanged item costs no download.
//   - Report Complete only when the listing covered everything the source's settings select. What a complete listing no
//     longer has is removed, so a listing that stopped early must never be reported complete.
//   - A connector that reports permissions sets them on every item. A permission it can't express maps to the nearest
//     narrower principal or to nobody, never wider, with a note saying why.
//   - Return the sink's errors as they are: they stop the sync (a cancelled run, a team limit).
package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/sourcetypes"
)

// Connector is one source type's behaviour.
type Connector interface {
	// Config validates a source's settings and returns them as they are stored (defaults filled in, unknown fields
	// refused). It makes no request. An error is shown to the person saving the source.
	Config(raw json.RawMessage) (json.RawMessage, error)
	// Check uses the credentials and says what they reach, for "Test connection" and for choosing what to index.
	Check(ctx context.Context, env Env) (CheckResult, error)
	// Sync lists what changed since req.Cursor (everything when req.Full or the cursor is empty) and writes it to
	// the sink.
	Sync(ctx context.Context, env Env, req Request, sink Sink) (Result, error)
}

// Env is what a connector works with for one source.
type Env struct {
	SourceID uuid.UUID
	// Config is the source's settings, as Config returned them.
	Config json.RawMessage
	// Credentials are the source's stored credentials by field key.
	Credentials map[string]string
	// HTTP is the client for every request: it refuses private addresses unless a platform admin allowed the host,
	// and it waits and retries when the provider throttles (429, 503 with Retry-After).
	HTTP *http.Client
	Log  *slog.Logger
}

// Request is one sync.
type Request struct {
	// Cursor is what the last sync returned or last gave to Sink.Checkpoint (nil for the first sync).
	Cursor json.RawMessage
	// Full asks for a complete listing even when there is a cursor.
	Full bool
}

// Result is how a sync ended.
type Result struct {
	// Cursor is saved for the next sync.
	Cursor json.RawMessage
	// Complete: the listing covered everything the settings select, so a document it did not mention is gone.
	Complete bool
}

// CheckResult is what a credential reaches.
type CheckResult struct {
	// Summary is one sentence for the person testing: who the credential is and what it can read.
	Summary string
	// Reachable lists what could be indexed (sites, drives, spaces, folders), for choosing in the form.
	Reachable []Reachable
}

// Reachable is one place a credential can read.
type Reachable struct {
	ID, Name, Kind string
}

// Item is one document in the provider.
type Item struct {
	// ID identifies the item in the provider for as long as it exists (at most 2048 bytes).
	ID string
	// Title is shown in lists and citations. Filename decides how the content is read (its extension), and may be
	// the title with an extension for content the connector converts itself (a page as "Title.html").
	Title, Filename string
	// URL opens the item in the provider. Citations link to it.
	URL string
	// ContentType is the content's media type, when the provider says.
	ContentType string
	// Version changes when the content does. Empty: the content is fetched every time and compared by hash.
	Version string
	// ModifiedAt is when the item last changed in the provider (zero when unknown).
	ModifiedAt time.Time
	// Open returns the content. It is called at most once, and only when the content is needed.
	Open func(ctx context.Context) (io.ReadCloser, error)
	// Permissions are who may read the item. Required for a type whose permissions come from the provider, and
	// ignored for one that reports none.
	Permissions *Permissions
}

// Permissions are who may read one item.
type Permissions struct {
	// Everyone: anyone who can use the knowledge may read it (the item is unrestricted).
	Everyone bool
	// Principals may read it: "email:<address>", "subject:<identity provider subject>", "group:<identity provider
	// group>" or "user:<Grounded user id>" (docs/specs/document-acls/DESIGN.md).
	Principals []string
	// Groups are the connector's own groups that may read it, by the IDs given to Sink.SetGroup.
	Groups []string
	// Notes say what was narrowed and why ("a link for anyone maps to nobody"). They are shown to editors.
	Notes []string
	// Raw is what the provider reported, kept for display and audit. It is never used to decide access.
	Raw json.RawMessage
}

// Outcome is what the sink did with an item.
type Outcome int

const (
	Added Outcome = iota
	Changed
	Unchanged
	Skipped
)

func (o Outcome) String() string {
	return [...]string{"added", "changed", "unchanged", "skipped"}[o]
}

// Sink receives a sync's findings.
type Sink interface {
	// Upsert adds the item or updates it. Its content is read only when it is new or its version changed.
	Upsert(ctx context.Context, item Item) (Outcome, error)
	// Delete removes the item the provider says is gone. Unknown IDs are ignored. Removals are applied at the end
	// of the sync, and held for an editor when they are a large share of the source.
	Delete(ctx context.Context, id string) error
	// SetPermissions replaces an item's permissions without reading its content again.
	SetPermissions(ctx context.Context, id string, p Permissions) error
	// SetGroup replaces the members of one of the connector's own groups. Members are principals, as in
	// Permissions.Principals. A group the connector stops setting keeps its members until a complete sync ends
	// without it.
	SetGroup(ctx context.Context, id string, members []string) error
	// Skip records an item that was left out and why (too large, an unsupported format, a locked file).
	Skip(ctx context.Context, id, title, reason string)
	// Checkpoint saves a cursor during a long sync, so a restart continues from it.
	Checkpoint(ctx context.Context, cursor json.RawMessage) error
}

// ErrCredentials: the provider refused the credentials. The sync fails with a message asking for new ones, and is not
// retried.
var ErrCredentials = errors.New("the provider refused the credentials")

// ErrStopped is returned by the sink when the sync must end now: it was cancelled, the source was paused, or the team
// reached a limit. A connector returns it unchanged.
var ErrStopped = errors.New("the sync was stopped")

// ConfigError is a problem with a source's settings, shown to the person saving them.
type ConfigError struct{ Message string }

func (e *ConfigError) Error() string { return e.Message }

// Invalid returns a ConfigError.
func Invalid(format string, args ...any) error {
	return &ConfigError{Message: fmt.Sprintf(format, args...)}
}

var (
	mu         sync.RWMutex
	connectors = map[string]Connector{}
)

// Register adds a connector and its source type. It panics on a duplicate or invalid type, like sourcetypes.Register:
// registration happens at start-up.
func Register(t sourcetypes.Type, c Connector) {
	if c == nil {
		panic("connector: nil connector for " + t.Key)
	}
	if t.BuiltIn || t.Uploads || t.WebPages {
		panic("connector: " + t.Key + " declares what only the built-in types do")
	}
	t.Sync = true
	sourcetypes.Register(t)
	mu.Lock()
	defer mu.Unlock()
	connectors[t.Key] = c
}

// Get returns a source type's connector.
func Get(key string) (Connector, bool) {
	mu.RLock()
	defer mu.RUnlock()
	c, ok := connectors[key]
	return c, ok
}
