package auditexport

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Publish uses the already-private install blob store only. No destination is
// accepted from requests. Each attempt uses a fresh object key, since Store.Put
// overwrites and offers no conditional create. Only the database CAS publishes.
// Key is supplied by the future secure operator-secret integration; never logged.
func Publish(ctx context.Context, pool *pgxpool.Pool, store blob.Store, id uuid.UUID, key ed25519.PrivateKey) (Envelope, error) {
	q := dbgen.New(pool)
	export, err := q.GetAuditExport(ctx, id)
	if err != nil {
		return Envelope{}, err
	}
	if export.State == "completed" {
		return decodeEnvelope(export.Envelope)
	}
	// Fail before any blob work; sign validates seed/public-key consistency too.
	if _, err := sign(Manifest{}, key); err != nil {
		return Envelope{}, err
	}
	f, err := os.CreateTemp("", "grounded-audit-export-*")
	if err != nil {
		return Envelope{}, ErrStorage
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	m, err := spool(ctx, q, export, f)
	if err != nil {
		return Envelope{}, err
	}
	e, err := sign(m, key)
	if err != nil {
		return Envelope{}, err
	}
	size, err := f.Seek(0, io.SeekCurrent)
	if err != nil {
		return Envelope{}, ErrStorage
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return Envelope{}, ErrStorage
	}
	objectKey := "audit-exports/" + id.String() + "/" + uuid.NewString() + "/payload.jsonl"
	if store == nil || store.Put(ctx, objectKey, f, size, "application/x-ndjson") != nil {
		return Envelope{}, ErrStorage
	}
	encoded, _ := json.Marshal(e)
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		tq := dbgen.New(tx)
		n, err := tq.PublishAuditExport(ctx, dbgen.PublishAuditExportParams{
			ID: id, ObjectKey: &objectKey, Envelope: encoded, EnvelopeHash: ptr(digest(encoded)),
		})
		if err != nil || n == 0 {
			return err
		}
		return audit.Record(ctx, tq, audit.Entry{ActorKind: audit.ActorSystem, Action: "audit_export.publish", TargetType: "platform_settings", TargetID: "audit_exports", Metadata: map[string]any{"exportId": id.String(), "count": m.Count}})
	})
	if err != nil {
		return Envelope{}, err
	}
	// A concurrent attempt may have won. Always return the committed identity.
	committed, err := q.GetAuditExport(ctx, id)
	if err != nil {
		return Envelope{}, err
	}
	return decodeEnvelope(committed.Envelope)
}

func ptr(s string) *string { return &s }

func decodeEnvelope(b []byte) (Envelope, error) {
	var e Envelope
	if json.Unmarshal(b, &e) != nil {
		return e, ErrInvalid
	}
	return e, nil
}

func spool(ctx context.Context, q *dbgen.Queries, e dbgen.AuditExport, w io.Writer) (Manifest, error) {
	m := Manifest{Version: Version, Day: e.Day.Time.Format("2006-01-02"), Snapshot: utc(e.SnapshotAt), Watermark: e.Watermark, PreviousExport: e.PreviousHash}
	h := sha256.New()
	out := io.MultiWriter(w, h)
	for {
		rows, err := q.ReadAuditExportPage(ctx, dbgen.ReadAuditExportPageParams{ExportID: e.ID, AfterID: m.LastID})
		if err != nil {
			return m, err
		}
		if len(rows) == 0 {
			break
		}
		for _, r := range rows {
			fact := Fact{ID: r.SourceID, At: utc(r.OccurredAt), ActorKind: r.ActorKind, Action: r.Action, TargetType: r.TargetType, TargetID: r.TargetID}
			if r.ActorUserID.Valid {
				fact.ActorUserID = r.ActorUserID.UUID.String()
			}
			if r.TeamID.Valid {
				fact.TeamID = r.TeamID.UUID.String()
			}
			m.Count++
			b, _ := json.Marshal(line{Ordinal: m.Count, Fact: fact, Previous: m.FinalHash})
			b = append(b, '\n')
			if _, err = out.Write(b); err != nil {
				return m, ErrStorage
			}
			if m.FirstID == 0 {
				m.FirstID = r.SourceID
			}
			m.LastID, m.FinalHash = r.SourceID, digest(b)
		}
	}
	m.PayloadHash = hex.EncodeToString(h.Sum(nil))
	return m, nil
}

// Open returns only a committed export selected by ID, never an arbitrary object
// key. It is INTERNAL: authorization and safe HTTP headers remain integration work.
func Open(ctx context.Context, pool *pgxpool.Pool, store blob.Store, id uuid.UUID) (Envelope, io.ReadCloser, error) {
	e, err := dbgen.New(pool).GetAuditExport(ctx, id)
	if err != nil {
		return Envelope{}, nil, err
	}
	if e.State != "completed" || e.ObjectKey == nil {
		return Envelope{}, nil, ErrInvalid
	}
	envelope, err := decodeEnvelope(e.Envelope)
	if err != nil {
		return Envelope{}, nil, err
	}
	r, err := store.Get(ctx, *e.ObjectKey)
	if err != nil {
		return Envelope{}, nil, ErrStorage
	}
	return envelope, r, nil
}
