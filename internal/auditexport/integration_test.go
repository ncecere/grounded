package auditexport

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestPGSnapshotPublishVerify(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	secret := "DOCUMENT conversation instructions Bearer sk-test-secret"
	canaries := []string{secret, base64.StdEncoding.EncodeToString([]byte(secret)), hex.EncodeToString([]byte(secret))}
	for _, v := range canaries {
		_, err := pool.Exec(ctx, `INSERT INTO audit_log (occurred_at,actor_kind,action,target_type,target_id,before_state,after_state,metadata,request_id,client_ip) VALUES ($1,'system','document.delete','document',$2,jsonb_build_object('text',$2::text),jsonb_build_object('instructions',$2::text),jsonb_build_object('headers',$2::text),$2,$2)`, day.Add(time.Hour), v)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err := pool.Exec(ctx, `INSERT INTO audit_log (occurred_at,actor_kind,action,target_type,target_id) SELECT $1::timestamptz + (i%60)*interval '1 minute','system','team.update','team','00000000-0000-0000-0000-000000000001' FROM generate_series(1,1030) i`, day)
	if err != nil {
		t.Fatal(err)
	}
	actor := audit.Entry{ActorKind: audit.ActorSystem}
	id, err := Freeze(ctx, pool, day, actor)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := Freeze(ctx, pool, day, actor)
	if err != nil || duplicate != id {
		t.Fatalf("duplicate %v %v", duplicate, err)
	}
	if _, err = Freeze(ctx, pool, day.AddDate(0, 0, 1), actor); err != ErrRange {
		t.Fatalf("pending predecessor: %v", err)
	}
	// This late source commit must never enter the frozen snapshot on retries.
	_, err = pool.Exec(ctx, `INSERT INTO audit_log (occurred_at,actor_kind,action,target_type) VALUES ($1,'system','late.commit','team')`, day)
	if err != nil {
		t.Fatal(err)
	}
	fs, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	if _, err = Publish(ctx, pool, fs, id, nil); err != ErrSigning {
		t.Fatalf("unsigned fallback: %v", err)
	}
	failing := &lostAckStore{Store: fs}
	if _, err = Publish(ctx, pool, failing, id, fixtureKey(1)); err != ErrStorage {
		t.Fatalf("lost upload ack: %v", err)
	}
	pending, err := dbgen.New(pool).GetAuditExport(ctx, id)
	if err != nil || pending.State != "pending" {
		t.Fatal("failure published", err)
	}
	e, err := Publish(ctx, pool, fs, id, fixtureKey(1))
	if err != nil {
		t.Fatal(err)
	}
	if e.Manifest.Count != 1033 {
		t.Fatalf("snapshot count %d", e.Manifest.Count)
	}
	downloaded, r, err := Open(ctx, pool, fs, id)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := io.ReadAll(r)
	_ = r.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err = Verify(downloaded, bytes.NewReader(payload), trust(fixtureKey(1))); err != nil {
		t.Fatal(err)
	}
	for _, v := range append(canaries, "late.commit") {
		if bytes.Contains(payload, []byte(v)) {
			t.Fatal("unsafe or late data exported")
		}
	}
	repeated, err := Publish(ctx, pool, fs, id, fixtureKey(2))
	if err != nil || repeated.Manifest.KeyID != e.Manifest.KeyID {
		t.Fatal("committed identity changed", err)
	}
	emptyID, err := Freeze(ctx, pool, day.AddDate(0, 0, 1), actor)
	if err != nil {
		t.Fatal(err)
	}
	empty, err := Publish(ctx, pool, fs, emptyID, fixtureKey(2))
	if err != nil {
		t.Fatal(err)
	}
	if empty.Manifest.Count != 0 || Verify(empty, strings.NewReader(""), trust(fixtureKey(2))) != nil || VerifyLink(e, empty) != nil {
		t.Fatal("empty day or rotated chain failed")
	}
	if _, err = Freeze(ctx, pool, day.AddDate(0, 0, 3), actor); err != ErrRange {
		t.Fatal("date gap allowed", err)
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	if _, err = Freeze(ctx, pool, today, actor); err != ErrRange {
		t.Fatal("open day allowed", err)
	}
	// Old ordinary writer remains compatible after the expand migration.
	if err = audit.Record(ctx, dbgen.New(pool), actor); err != nil {
		t.Fatal(err)
	}
}

type lostAckStore struct{ blob.Store }

func (s *lostAckStore) Put(ctx context.Context, key string, r io.Reader, n int64, ct string) error {
	if err := s.Store.Put(ctx, key, r, n, ct); err != nil {
		return err
	}
	return errors.New("simulated lost acknowledgement; credentials must not escape")
}

func TestPGConcurrentRequestAndPublication(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var ids [2]uuid.UUID
	var errs [2]error
	var wg sync.WaitGroup
	for i := range 2 {
		wg.Go(func() { ids[i], errs[i] = Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem}) })
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || ids[0] != ids[1] {
		t.Fatalf("concurrent freeze: %v %v", ids, errs)
	}
	fs, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	gate := &barrierStore{Store: fs, ready: make(chan struct{}, 2), release: make(chan struct{})}
	var out [2]Envelope
	for i := range 2 {
		wg.Go(func() { out[i], errs[i] = Publish(ctx, pool, gate, ids[i], fixtureKey(byte(i+1))) })
	}
	for range 2 {
		select {
		case <-gate.ready:
		case <-time.After(testutil.Scale(10 * time.Second)):
			t.Fatal("publish never reached store")
		}
	}
	close(gate.release)
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || out[0].Manifest.KeyID != out[1].Manifest.KeyID {
		t.Fatalf("concurrent publication diverged: %v", errs)
	}
	if gate.keys[0] == gate.keys[1] {
		t.Fatal("attempts share overwrite key")
	}
}

type barrierStore struct {
	blob.Store
	ready   chan struct{}
	release chan struct{}
	mu      sync.Mutex
	keys    []string
}

func (s *barrierStore) Put(ctx context.Context, key string, r io.Reader, n int64, ct string) error {
	s.mu.Lock()
	s.keys = append(s.keys, key)
	s.mu.Unlock()
	s.ready <- struct{}{}
	select {
	case <-s.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	return s.Store.Put(ctx, key, r, n, ct)
}
