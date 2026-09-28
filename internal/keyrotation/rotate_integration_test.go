package keyrotation_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/keyrotation"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/testutil"
)

func randKey(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return k
}

func box(t *testing.T, current []byte, previous ...[]byte) *secrets.Box {
	t.Helper()
	b, err := secrets.New(current, previous...)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// seeders insert one row holding a secret sealed by sealer into each
// registered column's table. Every encrypted column needs one, so a new
// column cannot be added without a rotation test.
var seeders = map[string]func(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, ct []byte) error{
	"model_connections.api_key_ciphertext": func(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, ct []byte) error {
		_, err := pool.Exec(ctx, `INSERT INTO model_connections (id, name, base_url, api_key_ciphertext, api_key_hint)
			VALUES ($1, $2, 'https://gateway.example.edu/v1', $3, 'x')`, id, "conn-"+id.String(), ct)
		return err
	},
}

// fixture is a database with secrets in every encrypted column.
type fixture struct {
	pool  *pgxpool.Pool
	plain map[uuid.UUID]string // id -> plaintext (secret rows only)
	cols  map[uuid.UUID]keyrotation.Column
}

// seed writes n secrets per column with sealer (plus two rows without a
// secret, where the column allows it).
func seed(t *testing.T, pool *pgxpool.Pool, f *fixture, sealer *secrets.Box, n int) {
	t.Helper()
	ctx := context.Background()
	for _, c := range keyrotation.Columns {
		ins, ok := seeders[c.Name()]
		if !ok {
			t.Fatalf("no test seeder for encrypted column %s", c.Name())
		}
		for i := 0; i < n; i++ {
			id := uuid.New()
			plain := fmt.Sprintf("sk-%s-%d-%s", c.Table, i, uuid.NewString()[:8])
			ct, err := sealer.Seal([]byte(plain), c.AAD(id))
			if err != nil {
				t.Fatal(err)
			}
			if err := ins(ctx, pool, id, ct); err != nil {
				t.Fatal(err)
			}
			f.plain[id], f.cols[id] = plain, c
		}
		for i := 0; i < 2; i++ {
			if err := ins(ctx, pool, uuid.New(), nil); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func newFixture(t *testing.T) *fixture {
	pool, _ := testutil.NewDB(t)
	return &fixture{pool: pool, plain: map[uuid.UUID]string{}, cols: map[uuid.UUID]keyrotation.Column{}}
}

// stored reads every ciphertext of every column.
func (f *fixture) stored(t *testing.T) map[uuid.UUID][]byte {
	t.Helper()
	out := map[uuid.UUID][]byte{}
	for _, c := range keyrotation.Columns {
		rows, err := f.pool.Query(context.Background(), fmt.Sprintf("SELECT id, %s FROM %s WHERE %s IS NOT NULL", c.Column, c.Table, c.Column))
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id uuid.UUID
			var ct []byte
			if err := rows.Scan(&id, &ct); err != nil {
				t.Fatal(err)
			}
			out[id] = ct
		}
		rows.Close()
	}
	return out
}

// checkAll asserts every secret opens with only the given box (no
// previous key) to its original value.
func (f *fixture) checkAll(t *testing.T, only *secrets.Box) {
	t.Helper()
	got := f.stored(t)
	if len(got) != len(f.plain) {
		t.Fatalf("%d stored secrets, want %d", len(got), len(f.plain))
	}
	for id, ct := range got {
		pt, err := only.Open(ct, f.cols[id].AAD(id))
		if err != nil || string(pt) != f.plain[id] {
			t.Fatalf("%s %s: %v", f.cols[id].Name(), id, err)
		}
	}
}

func (f *fixture) audit(t *testing.T) (actions []string, metadata string) {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), "SELECT action, actor_kind, metadata::text, coalesce(before_state::text, ''), coalesce(after_state::text, '') FROM audit_log ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var all strings.Builder
	for rows.Next() {
		var action, kind, meta, before, after string
		if err := rows.Scan(&action, &kind, &meta, &before, &after); err != nil {
			t.Fatal(err)
		}
		if kind != "system" || before != "" || after != "" {
			t.Errorf("%s: actor %s, before %q, after %q", action, kind, before, after)
		}
		actions = append(actions, action)
		all.WriteString(meta + "\n")
	}
	return actions, all.String()
}

func TestRotateEveryEncryptedColumn(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	oldKey, newKey := randKey(t), randKey(t)
	seed(t, f.pool, f, box(t, oldKey), 250)
	seed(t, f.pool, f, box(t, newKey), 3) // already rotated (a re-saved connection)
	rotating := box(t, newKey, oldKey)
	before := f.stored(t)

	// Dry run: counts, and nothing written (not even the audit log).
	var out bytes.Buffer
	sum, err := keyrotation.Run(ctx, f.pool, rotating, secrets.Peppers{}, keyrotation.Options{DryRun: true, BatchSize: 100, Out: &out})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range sum.Columns {
		if c.Total != 253 || c.Previous != 250 || c.Current != 3 || c.Reencrypted != 0 {
			t.Fatalf("dry run %s = %+v", c.Column, c)
		}
	}
	if !strings.Contains(out.String(), "250 on the previous key") || !strings.Contains(out.String(), "Dry run: nothing was written") {
		t.Fatalf("dry run output:\n%s", out.String())
	}
	after := f.stored(t)
	for id, ct := range before {
		if !bytes.Equal(after[id], ct) {
			t.Fatal("dry run changed a stored value")
		}
	}
	if actions, _ := f.audit(t); len(actions) != 0 {
		t.Fatalf("dry run audited %v", actions)
	}

	out.Reset()
	sum, err = keyrotation.Run(ctx, f.pool, rotating, secrets.Peppers{}, keyrotation.Options{BatchSize: 100, Out: &out})
	if err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
	if sum.Reencrypted() != 250*len(keyrotation.Columns) {
		t.Fatalf("re-encrypted %d", sum.Reencrypted())
	}
	f.checkAll(t, box(t, newKey))

	// Audited as the system with counts only: one entry per batch, one summary.
	actions, meta := f.audit(t)
	want := []string{"platform.secrets_reencrypt", "platform.secrets_reencrypt", "platform.secrets_reencrypt", "platform.key_rotation"}
	if !slices.Equal(actions, want) {
		t.Fatalf("audit = %v", actions)
	}
	for id, p := range f.plain {
		if strings.Contains(meta, p) || strings.Contains(meta, id.String()) {
			t.Fatalf("audit metadata names a secret or row: %s", meta)
		}
	}
	for _, s := range []string{`"rows": 100`, `"rows": 50`, `"reencrypted": 250`, `"alreadyCurrent": 3`} {
		if !strings.Contains(meta, s) {
			t.Errorf("audit metadata lacks %s: %s", s, meta)
		}
	}

	// Idempotent: nothing left to do.
	sum, err = keyrotation.Run(ctx, f.pool, rotating, secrets.Peppers{}, keyrotation.Options{Out: io.Discard})
	if err != nil || sum.Reencrypted() != 0 || sum.Columns[0].Current != 253 {
		t.Fatalf("second run = %+v, %v", sum, err)
	}
}

// cancelAfter cancels a run once n progress lines (committed batches)
// have been written.
type cancelAfter struct {
	n      int
	cancel context.CancelFunc
}

func (c *cancelAfter) Write(p []byte) (int, error) {
	if bytes.Contains(p, []byte(" of ")) {
		if c.n--; c.n == 0 {
			c.cancel()
		}
	}
	return len(p), nil
}

func TestRotateResumesAfterInterruption(t *testing.T) {
	f := newFixture(t)
	oldKey, newKey := randKey(t), randKey(t)
	seed(t, f.pool, f, box(t, oldKey), 120)
	rotating := box(t, newKey, oldKey)

	ctx, cancel := context.WithCancel(context.Background())
	_, err := keyrotation.Run(ctx, f.pool, rotating, secrets.Peppers{}, keyrotation.Options{BatchSize: 50, Out: &cancelAfter{n: 1, cancel: cancel}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted run = %v", err)
	}
	onNew := 0
	for _, ct := range f.stored(t) {
		if rotating.Which(ct) == secrets.SlotCurrent {
			onNew++
		}
	}
	if onNew != 50 {
		t.Fatalf("%d values on the new key after one committed batch", onNew)
	}
	// Readers accept both keys meanwhile.
	f.checkAll(t, rotating)

	sum, err := keyrotation.Run(context.Background(), f.pool, rotating, secrets.Peppers{}, keyrotation.Options{BatchSize: 50})
	if err != nil || sum.Reencrypted() != 70 || sum.Columns[0].Current != 50 {
		t.Fatalf("resumed run = %+v, %v", sum, err)
	}
	f.checkAll(t, box(t, newKey))
}

func TestRotateRefusals(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	oldKey, newKey := randKey(t), randKey(t)
	seed(t, f.pool, f, box(t, oldKey), 5)
	before := f.stored(t)

	if _, err := keyrotation.Run(ctx, f.pool, box(t, newKey), secrets.Peppers{}, keyrotation.Options{}); !errors.Is(err, keyrotation.ErrNoPreviousKey) {
		t.Fatalf("no previous key = %v", err)
	}
	if _, err := keyrotation.Run(ctx, f.pool, box(t, oldKey, oldKey), secrets.Peppers{}, keyrotation.Options{}); !errors.Is(err, keyrotation.ErrNoPreviousKey) {
		t.Fatalf("previous equal to current = %v", err)
	}

	// One value sealed with a third key: reported by table and id, and
	// nothing is written, in a dry run or not.
	strayID := uuid.New()
	ct, _ := box(t, randKey(t)).Seal([]byte("sk-stray"), keyrotation.Columns[0].AAD(strayID))
	if err := seeders[keyrotation.Columns[0].Name()](ctx, f.pool, strayID, ct); err != nil {
		t.Fatal(err)
	}
	for _, dry := range []bool{true, false} {
		_, err := keyrotation.Run(ctx, f.pool, box(t, newKey, oldKey), secrets.Peppers{}, keyrotation.Options{DryRun: dry})
		var bad *keyrotation.UndecryptableError
		if !errors.As(err, &bad) || len(bad.Rows) != 1 || bad.Rows[0].ID != strayID || bad.Rows[0].Reason != "unknown key" {
			t.Fatalf("dry=%v: %v", dry, err)
		}
		if msg := err.Error(); !strings.Contains(msg, keyrotation.Columns[0].Name()+" id="+strayID.String()) || strings.Contains(msg, "sk-stray") {
			t.Fatalf("message = %s", msg)
		}
	}
	after := f.stored(t)
	for id, ct := range before {
		if !bytes.Equal(after[id], ct) {
			t.Fatal("a refused run changed a stored value")
		}
	}
	if actions, _ := f.audit(t); len(actions) != 0 {
		t.Fatalf("refused runs audited %v", actions)
	}
}

// Every bytea column is either a registered ciphertext column or a known
// non-secret one, so a new encrypted column cannot miss rotation.
func TestEveryEncryptedColumnIsRegistered(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	known := map[string]bool{
		"api_keys.secret_hash": true, "api_keys.pepper_id": true, // HMAC digests (pepper rotation)
		"publishable_keys.secret_hash": true, "publishable_keys.pepper_id": true,
		"river_job.unique_key": true,
	}
	for _, c := range keyrotation.Columns {
		known[c.Name()] = true
	}
	rows, err := pool.Query(context.Background(),
		"SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'bytea'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		if !known[name] {
			t.Errorf("bytea column %s: add it to keyrotation.Columns if it holds internal/secrets ciphertexts, or to this test's known list", name)
		}
	}
}
