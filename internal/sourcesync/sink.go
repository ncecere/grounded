package sourcesync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/strutil"
)

// sink is the connector.Sink of one sync.
type sink struct {
	s   *Service
	src dbgen.DataSource
	run dbgen.SourceSync
	// provider: the type reports permissions, so every document's list is written from the item.
	provider bool
	// counts not yet written to the sync's row, and when they were last written.
	added, changed, unchanged, skipped, permissions int32
	flushed                                         time.Time
	// groups the connector set during this sync.
	groups map[string]bool
	// stop is why the sync must end early ("" while it may go on), and checked when the row was last read for it.
	stop    string
	checked time.Time
}

func (s *Service) newSink(src dbgen.DataSource, run dbgen.SourceSync) *sink {
	return &sink{s: s, src: src, run: run, groups: map[string]bool{},
		provider: sourcetypes.Of(src.Type).Permissions == sourcetypes.PermissionsProvider}
}

// alive returns connector.ErrStopped once the sync was cancelled or its source paused. The row is read at most every
// Service.checkEvery.
func (k *sink) alive(ctx context.Context) error {
	if k.stop != "" {
		return connector.ErrStopped
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if now := k.s.now(); now.Sub(k.checked) >= k.s.checkEvery {
		k.checked = now
		run, err := k.s.q.GetSourceSync(ctx, k.run.ID)
		if err != nil {
			return err
		}
		if !Active(run) {
			k.stop = "cancelled"
			return connector.ErrStopped
		}
	}
	return nil
}

// flush writes the counts to the sync's row (every two seconds while a sync runs, and when it ends).
func (k *sink) flush(ctx context.Context, force bool) error {
	now := k.s.now()
	if !force && now.Sub(k.flushed) < 2*time.Second {
		return nil
	}
	k.flushed = now
	if k.added+k.changed+k.unchanged+k.skipped+k.permissions == 0 {
		return nil
	}
	err := k.s.q.AddSourceSyncCounts(ctx, dbgen.AddSourceSyncCountsParams{ID: k.run.ID, Added: k.added, Changed: k.changed,
		Unchanged: k.unchanged, Skipped: k.skipped, PermissionsChanged: k.permissions})
	if err == nil {
		for result, n := range map[string]int32{"added": k.added, "changed": k.changed, "unchanged": k.unchanged, "skipped": k.skipped} {
			observability.ConnectorItems.WithLabelValues(k.src.Type, result).Add(float64(n))
		}
		k.added, k.changed, k.unchanged, k.skipped, k.permissions = 0, 0, 0, 0, 0
	}
	return err
}

func (k *sink) Skip(ctx context.Context, id, title, reason string) {
	k.skipped++
	problem := mustJSON(map[string]string{"id": strutil.Clip(id, 300), "title": strutil.Clip(title, 300), "reason": strutil.Clip(reason, 300)})
	if err := k.s.q.AddSourceSyncProblem(ctx, dbgen.AddSourceSyncProblemParams{ID: k.run.ID, Problem: problem}); err != nil {
		k.s.Log.WarnContext(ctx, "could not record a skipped item", "sync", k.run.ID, "err", err)
	}
}

func (k *sink) find(ctx context.Context, id string) (dbgen.Document, bool, error) {
	doc, err := k.s.q.FindDocumentByExternalID(ctx, dbgen.FindDocumentByExternalIDParams{SourceID: k.src.ID, ExternalID: id})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return doc, false, nil
	}
	return doc, err == nil, err
}

func (k *sink) Upsert(ctx context.Context, item connector.Item) (connector.Outcome, error) {
	if err := k.alive(ctx); err != nil {
		return connector.Skipped, err
	}
	defer func() { _ = k.flush(ctx, false) }()
	name := item.Filename
	if name == "" {
		name = item.Title
	}
	switch {
	case item.ID == "" || len(item.ID) > 2048:
		k.Skip(ctx, item.ID, item.Title, "The provider gave no usable identifier for this item")
		return connector.Skipped, nil
	case !parse.IndexableName(name):
		k.Skip(ctx, item.ID, name, "This kind of file is not indexed")
		return connector.Skipped, nil
	}
	doc, found, err := k.find(ctx, item.ID)
	if err != nil {
		return connector.Skipped, err
	}
	var principals []string
	var acl json.RawMessage
	if k.provider {
		principals, acl = resolve(k.src.ID, item.Permissions)
	}
	if found && item.Version != "" && doc.ExternalVersion == item.Version {
		return connector.Unchanged, k.seen(ctx, doc, item, principals, acl)
	}
	return k.store(ctx, doc, found, item, name, principals, acl)
}

// seen records an item whose content did not change: the sync saw it, its name and address are current, and its
// permissions are as the provider says now.
func (k *sink) seen(ctx context.Context, doc dbgen.Document, item connector.Item, principals []string, acl json.RawMessage) error {
	q := k.s.q
	if err := q.TouchConnectorDocument(ctx, dbgen.TouchConnectorDocumentParams{ID: doc.ID, SyncID: nullUUID(k.run.ID),
		Title: strutil.Clip(item.Title, 500), Filename: strutil.Clip(item.Filename, 255), URL: clipURL(item.URL), ExternalVersion: item.Version, Modified: modified(item.ModifiedAt)}); err != nil {
		return err
	}
	if err := q.DropSyncRemoval(ctx, dbgen.DropSyncRemovalParams{SyncID: k.run.ID, DocumentID: doc.ID}); err != nil {
		return err
	}
	k.unchanged++
	if !k.provider {
		return nil
	}
	n, err := q.SetDocumentPermissions(ctx, dbgen.SetDocumentPermissionsParams{ID: doc.ID, Principals: principals, Acl: acl})
	k.permissions += int32(n)
	return err
}

// store reads an item's content and saves it as a new document or a new version. Content that turns out to be the same
// as what is stored (by hash) is not processed again.
func (k *sink) store(ctx context.Context, doc dbgen.Document, found bool, item connector.Item, name string, principals []string, acl json.RawMessage) (connector.Outcome, error) {
	s := k.s
	if item.Open == nil {
		k.Skip(ctx, item.ID, name, "The connector gave no content for this item")
		return connector.Skipped, nil
	}
	rc, err := item.Open(ctx)
	if err != nil {
		if errors.Is(err, connector.ErrCredentials) || ctx.Err() != nil {
			return connector.Skipped, err
		}
		k.Skip(ctx, item.ID, name, "Its content could not be read: "+err.Error())
		return connector.Skipped, nil
	}
	defer rc.Close()
	docID := uuid.New()
	if found {
		docID = doc.ID
	}
	key := ingest.NewOriginalKey(k.src.TeamID, k.src.ID, docID)
	sn := &sniffer{r: io.LimitReader(rc, s.MaxBytes+1), h: sha256.New()}
	if err := s.Blob.Put(ctx, key, sn, -1, item.ContentType); err != nil {
		return connector.Skipped, err
	}
	discard := func() { _ = s.Blob.Delete(context.WithoutCancel(ctx), key) }
	switch {
	case sn.n > s.MaxBytes:
		discard()
		k.Skip(ctx, item.ID, name, "It is larger than the limit of "+limits.FormatBytes(s.MaxBytes))
		return connector.Skipped, nil
	case sn.n == 0:
		discard()
		k.Skip(ctx, item.ID, name, "It is empty")
		return connector.Skipped, nil
	}
	sum := hex.EncodeToString(sn.h.Sum(nil))
	if found && doc.Sha256 == sum {
		discard()
		return connector.Unchanged, k.seen(ctx, doc, item, principals, acl)
	}
	need := limits.Need{Bytes: sn.n, Documents: 1}
	if found {
		need = limits.Need{Bytes: sn.n - doc.SizeBytes}
	}
	inserted, err := k.save(ctx, need, dbgen.UpsertConnectorDocumentParams{
		ID: docID, SourceID: k.src.ID, TeamID: k.src.TeamID, ExternalID: item.ID, Title: strutil.Clip(item.Title, 500), Filename: strutil.Clip(name, 255),
		URL: clipURL(item.URL), ContentType: strutil.Clip(item.ContentType, 200), SizeBytes: sn.n, Sha256: sum, BlobKey: key,
		ExternalVersion: item.Version, Modified: modified(item.ModifiedAt), SyncID: nullUUID(k.run.ID),
		SetAcl: k.provider, Principals: principals, Acl: acl,
	})
	if err != nil {
		discard()
		return connector.Skipped, err
	}
	if found && doc.BlobKey != "" && doc.BlobKey != key {
		if err := s.Blob.DeletePrefix(context.WithoutCancel(ctx), strings.TrimSuffix(doc.BlobKey, "original")); err != nil {
			s.Log.WarnContext(ctx, "could not delete stored files", "document", doc.ID, "err", err)
		}
	}
	if inserted {
		k.added++
		return connector.Added, nil
	}
	k.changed++
	return connector.Changed, nil
}

// save writes the document within the team's limits and queues it for processing. A team at its documents or storage
// limit stops the sync: the rest of the listing would only be refused too.
func (k *sink) save(ctx context.Context, need limits.Need, p dbgen.UpsertConnectorDocumentParams) (inserted bool, err error) {
	s := k.s
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if k.src.TeamID.Valid && s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, k.src.TeamID.UUID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, k.src.TeamID.UUID, need); err != nil {
				return err
			}
		}
		row, err := q.UpsertConnectorDocument(ctx, p)
		if err != nil {
			return err
		}
		inserted = row.Inserted
		if err := q.DropSyncRemoval(ctx, dbgen.DropSyncRemovalParams{SyncID: k.run.ID, DocumentID: row.ID}); err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	var le *limits.Error
	if errors.As(err, &le) {
		k.stop = "limit:" + string(le.Def.Key)
		return false, connector.ErrStopped
	}
	return inserted, err
}

func (k *sink) Delete(ctx context.Context, id string) error {
	if err := k.alive(ctx); err != nil {
		return err
	}
	return k.s.q.AddSyncRemoval(ctx, dbgen.AddSyncRemovalParams{SyncID: k.run.ID, SourceID: k.src.ID, ExternalID: id})
}

func (k *sink) SetPermissions(ctx context.Context, id string, p connector.Permissions) error {
	if err := k.alive(ctx); err != nil {
		return err
	}
	if !k.provider {
		return nil
	}
	doc, found, err := k.find(ctx, id)
	if err != nil || !found {
		return err
	}
	principals, acl := resolve(k.src.ID, &p)
	n, err := k.s.q.SetDocumentPermissions(ctx, dbgen.SetDocumentPermissionsParams{ID: doc.ID, Principals: principals, Acl: acl})
	k.permissions += int32(n)
	return err
}

func (k *sink) SetGroup(ctx context.Context, id string, members []string) error {
	if err := k.alive(ctx); err != nil {
		return err
	}
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" || len(id) > maxGroupID {
		return nil // a group that can't be named gives nobody access
	}
	list := groupMembers(members)
	err := pgx.BeginFunc(ctx, k.s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := q.DeleteSourceGroup(ctx, dbgen.DeleteSourceGroupParams{SourceID: k.src.ID, GroupID: id}); err != nil {
			return err
		}
		return q.InsertSourceGroupMembers(ctx, dbgen.InsertSourceGroupMembersParams{SourceID: k.src.ID, GroupID: id, Principals: list})
	})
	if err == nil {
		k.groups[id] = true
	}
	return err
}

func (k *sink) Checkpoint(ctx context.Context, cursor json.RawMessage) error {
	if err := k.alive(ctx); err != nil {
		return err
	}
	if !json.Valid(cursor) {
		return errors.New("sourcesync: a checkpoint must be JSON")
	}
	if err := k.flush(ctx, true); err != nil {
		return err
	}
	return k.s.q.SetSourceSyncCheckpoint(ctx, dbgen.SetSourceSyncCheckpointParams{ID: k.run.ID, Checkpoint: cursor})
}

// sniffer hashes and counts a stream as it is stored.
type sniffer struct {
	r io.Reader
	h hash.Hash
	n int64
}

func (s *sniffer) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	if n > 0 {
		s.h.Write(p[:n])
		s.n += int64(n)
	}
	return n, err
}

// clipURL keeps an address only when it is an http(s) link that fits the column a citation opens.
func clipURL(u string) string {
	if len(u) > 2048 || !(strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) {
		return ""
	}
	return u
}

func modified(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(http.TimeFormat)
}
