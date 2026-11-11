// Package connectortest is an in-memory provider and its connector, for tests of the connector runtime and as the
// reference a new connector's tests can follow. It is never linked into the product.
//
// A Provider is a small document store with the things a real one has: stable item IDs, versions, a change feed with a
// cursor, deletions, permissions and its own groups, credentials it can refuse, and faults to inject. A source reaches
// its provider through the "tenant" setting, so tests running in parallel each have their own.
package connectortest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/sourcetypes"
)

// The two registered types: one whose permissions come from the provider, and one that reports none.
const (
	TypeDrive  = "test_drive"
	TypeBucket = "test_bucket"
)

// Schema is the settings schema both types declare.
const Schema = `{"type":"object","required":["tenant"],"additionalProperties":false,"x-order":["tenant","folder"],"properties":{
	"tenant":{"type":"string","title":"Tenant"},"folder":{"type":"string","title":"Folder","description":"Only items under this folder"}}}`

var registerOnce sync.Once

// Register adds the two test types to the registry (once per process).
func Register() {
	registerOnce.Do(func() {
		fields := []sourcetypes.Field{
			{Key: "token", Label: "Access token", Help: "The provider's token", Secret: true, Required: true},
			{Key: "account", Label: "Account"},
		}
		connector.Register(sourcetypes.Type{Key: TypeDrive, Name: "Test drive", Description: "An in-memory provider with permissions",
			Capabilities: sourcetypes.Capabilities{Permissions: sourcetypes.PermissionsProvider},
			ConfigSchema: []byte(Schema), Credentials: fields}, Connector{})
		connector.Register(sourcetypes.Type{Key: TypeBucket, Name: "Test bucket", Description: "An in-memory provider without permissions",
			ConfigSchema: []byte(Schema), Credentials: fields}, Connector{})
	})
}

// File is one item in a provider.
type File struct {
	ID, Name, Title, Content string
	// Version is bumped by Put when the content changes.
	Version int
	// Permissions as the provider would report them (nil: the connector reports none for this item).
	Permissions *connector.Permissions
}

type change struct {
	seq     int
	id      string
	deleted bool
}

// Provider is one tenant's in-memory store.
type Provider struct {
	Tenant string
	// Token is the credential the provider accepts.
	Token string

	mu     sync.Mutex
	files  map[string]*File
	groups map[string][]string
	log    []change
	seq    int
	// Opens counts content downloads; Syncs counts syncs started.
	opens, syncs int
	// faults
	failSyncs  int   // the next n syncs fail after listing half
	failErr    error // with this error
	hideAll    bool  // a full listing returns nothing and still says it is complete
	onItem     func(n int)
	checkpoint int // checkpoint every n items (0: never)
	resumed    []json.RawMessage
}

var (
	providersMu sync.Mutex
	providers   = map[string]*Provider{}
)

// NewProvider makes a provider with its own tenant and token.
func NewProvider() *Provider {
	p := &Provider{Tenant: "tenant-" + uuid.NewString()[:12], Token: "tok-" + uuid.NewString(), files: map[string]*File{}, groups: map[string][]string{}}
	providersMu.Lock()
	providers[p.Tenant] = p
	providersMu.Unlock()
	return p
}

// Close forgets the provider.
func (p *Provider) Close() {
	providersMu.Lock()
	delete(providers, p.Tenant)
	providersMu.Unlock()
}

func provider(tenant string) (*Provider, bool) {
	providersMu.Lock()
	defer providersMu.Unlock()
	p, ok := providers[tenant]
	return p, ok
}

// Put adds a file or changes it. The version moves only when the content does.
func (p *Provider) Put(id, name, content string, perms *connector.Permissions) {
	p.mu.Lock()
	defer p.mu.Unlock()
	f, ok := p.files[id]
	if !ok {
		f = &File{ID: id}
		p.files[id] = f
	}
	if f.Content != content {
		f.Version++
	}
	f.Name, f.Title, f.Content, f.Permissions = name, strings.TrimSuffix(name[strings.LastIndex(name, "/")+1:], ".md"), content, perms
	p.note(id, false)
}

// Rename changes a file's name (and so its folder) and keeps its ID, content and version.
func (p *Provider) Rename(id, name string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if f, ok := p.files[id]; ok {
		f.Name, f.Title = name, strings.TrimSuffix(name[strings.LastIndex(name, "/")+1:], ".md")
		p.note(id, false)
	}
}

// Share replaces a file's permissions without changing its content.
func (p *Provider) Share(id string, perms *connector.Permissions) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if f, ok := p.files[id]; ok {
		f.Permissions = perms
		p.note(id, false)
	}
}

// Delete removes a file.
func (p *Provider) Delete(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.files[id]; ok {
		delete(p.files, id)
		p.note(id, true)
	}
}

// SetGroup sets one of the provider's own groups (nil members removes it).
func (p *Provider) SetGroup(id string, members []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if members == nil {
		delete(p.groups, id)
	} else {
		p.groups[id] = members
	}
}

func (p *Provider) note(id string, deleted bool) {
	p.seq++
	p.log = append(p.log, change{seq: p.seq, id: id, deleted: deleted})
}

// Opens is how many times content was downloaded, and Syncs how many syncs started.
func (p *Provider) Opens() int { p.mu.Lock(); defer p.mu.Unlock(); return p.opens }
func (p *Provider) Syncs() int { p.mu.Lock(); defer p.mu.Unlock(); return p.syncs }

// Resumed lists the cursors of syncs that started from a checkpoint.
func (p *Provider) Resumed() []json.RawMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]json.RawMessage(nil), p.resumed...)
}

// FailSyncs makes the next n syncs fail with err after handing over half of what they would.
func (p *Provider) FailSyncs(n int, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.failSyncs, p.failErr = n, err
}

// HideAll makes full listings come back empty and complete, as a provider does when a permission was revoked or the
// wrong folder is named.
func (p *Provider) HideAll(on bool) { p.mu.Lock(); defer p.mu.Unlock(); p.hideAll = on }

// OnItem is called before each item is handed over, with its number in the sync (from 1).
func (p *Provider) OnItem(fn func(n int)) { p.mu.Lock(); defer p.mu.Unlock(); p.onItem = fn }

// CheckpointEvery makes syncs save a checkpoint every n items.
func (p *Provider) CheckpointEvery(n int) { p.mu.Lock(); defer p.mu.Unlock(); p.checkpoint = n }

type settings struct {
	Tenant string `json:"tenant"`
	Folder string `json:"folder,omitempty"`
}

type cursor struct {
	Seq int `json:"seq"`
	// Listing: a full listing got as far as this many items (a checkpoint); 0 for a delta cursor.
	Listing int  `json:"listing,omitempty"`
	Full    bool `json:"full,omitempty"`
}

// Connector is the test types' connector.
type Connector struct{}

func (Connector) Config(raw json.RawMessage) (json.RawMessage, error) {
	var s settings
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return nil, connector.Invalid("The settings have a field this source type does not take")
	}
	s.Tenant, s.Folder = strings.TrimSpace(s.Tenant), strings.Trim(strings.TrimSpace(s.Folder), "/")
	if s.Tenant == "" {
		return nil, connector.Invalid("Tenant is required")
	}
	return json.Marshal(s)
}

func open(env connector.Env) (*Provider, settings, error) {
	var s settings
	if err := json.Unmarshal(env.Config, &s); err != nil {
		return nil, s, err
	}
	p, ok := provider(s.Tenant)
	if !ok {
		return nil, s, fmt.Errorf("tenant %s does not exist", s.Tenant)
	}
	if env.Credentials["token"] != p.Token {
		return nil, s, fmt.Errorf("token %s: %w", env.Credentials["token"], connector.ErrCredentials)
	}
	return p, s, nil
}

func (Connector) Check(_ context.Context, env connector.Env) (connector.CheckResult, error) {
	p, _, err := open(env)
	if err != nil {
		return connector.CheckResult{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	folders := map[string]bool{}
	for _, f := range p.files {
		if i := strings.Index(f.Name, "/"); i > 0 {
			folders[f.Name[:i]] = true
		}
	}
	res := connector.CheckResult{Summary: fmt.Sprintf("Signed in to %s; %d files", p.Tenant, len(p.files))}
	for name := range folders {
		res.Reachable = append(res.Reachable, connector.Reachable{ID: name, Name: name, Kind: "folder"})
	}
	sort.Slice(res.Reachable, func(i, j int) bool { return res.Reachable[i].ID < res.Reachable[j].ID })
	return res, nil
}

func inFolder(name, folder string) bool {
	return folder == "" || strings.HasPrefix(name, folder+"/")
}

// plan is what one sync will hand over, taken under the lock.
type plan struct {
	upserts []File
	deletes []string
	groups  map[string][]string
	cur     cursor
	fail    error
	onItem  func(int)
	every   int
	full    bool
}

func (p *Provider) plan(s settings, req connector.Request) plan {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.syncs++
	var from cursor
	_ = json.Unmarshal(req.Cursor, &from)
	pl := plan{groups: map[string][]string{}, cur: cursor{Seq: p.seq}, onItem: p.onItem, every: p.checkpoint}
	pl.full = req.Full || len(req.Cursor) == 0 || from.Full
	if from.Listing > 0 {
		p.resumed = append(p.resumed, append(json.RawMessage(nil), req.Cursor...))
	}
	for id, m := range p.groups {
		pl.groups[id] = append([]string(nil), m...)
	}
	if p.failSyncs > 0 {
		p.failSyncs--
		pl.fail = p.failErr
	}
	if pl.full {
		if !p.hideAll {
			for _, f := range p.files {
				if inFolder(f.Name, s.Folder) {
					pl.upserts = append(pl.upserts, *f)
				}
			}
		}
		sort.Slice(pl.upserts, func(i, j int) bool { return pl.upserts[i].ID < pl.upserts[j].ID })
		if from.Listing > 0 && from.Listing <= len(pl.upserts) {
			pl.upserts = pl.upserts[from.Listing:]
		}
		return pl
	}
	last := map[string]change{}
	for _, c := range p.log {
		if c.seq > from.Seq {
			last[c.id] = c
		}
	}
	for id, c := range last {
		f, ok := p.files[id]
		if c.deleted || !ok || !inFolder(f.Name, s.Folder) {
			pl.deletes = append(pl.deletes, id) // gone, or moved out of the folder the source indexes
			continue
		}
		pl.upserts = append(pl.upserts, *f)
	}
	sort.Slice(pl.upserts, func(i, j int) bool { return pl.upserts[i].ID < pl.upserts[j].ID })
	sort.Strings(pl.deletes)
	return pl
}

func (Connector) Sync(ctx context.Context, env connector.Env, req connector.Request, sink connector.Sink) (connector.Result, error) {
	p, s, err := open(env)
	if err != nil {
		return connector.Result{}, err
	}
	pl := p.plan(s, req)
	var from cursor
	_ = json.Unmarshal(req.Cursor, &from)
	for id, members := range pl.groups {
		if err := sink.SetGroup(ctx, id, members); err != nil {
			return connector.Result{}, err
		}
	}
	for i, f := range pl.upserts {
		if pl.fail != nil && i >= len(pl.upserts)/2 {
			return connector.Result{}, pl.fail
		}
		if pl.onItem != nil {
			pl.onItem(i + 1)
		}
		f := f
		if _, err := sink.Upsert(ctx, connector.Item{
			ID: f.ID, Title: f.Title, Filename: f.Name[strings.LastIndex(f.Name, "/")+1:], URL: "https://files.example.org/" + p.Tenant + "/" + f.ID,
			ContentType: "text/markdown", Version: fmt.Sprintf("v%d", f.Version), Permissions: f.Permissions,
			Open: func(context.Context) (io.ReadCloser, error) {
				p.mu.Lock()
				p.opens++
				p.mu.Unlock()
				return io.NopCloser(strings.NewReader(f.Content)), nil
			},
		}); err != nil {
			return connector.Result{}, err
		}
		if pl.every > 0 && (i+1)%pl.every == 0 && pl.full {
			cp, _ := json.Marshal(cursor{Seq: pl.cur.Seq, Listing: from.Listing + i + 1, Full: true})
			if err := sink.Checkpoint(ctx, cp); err != nil {
				return connector.Result{}, err
			}
		}
	}
	if pl.fail != nil {
		return connector.Result{}, pl.fail
	}
	for _, id := range pl.deletes {
		if err := sink.Delete(ctx, id); err != nil {
			return connector.Result{}, err
		}
	}
	out, _ := json.Marshal(pl.cur)
	return connector.Result{Cursor: out, Complete: pl.full}, nil
}

// ErrOutage is a provider failure for FailSyncs.
var ErrOutage = errors.New("the provider is unavailable (503)")
