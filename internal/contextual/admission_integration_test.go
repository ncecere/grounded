package contextual

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func configureCallAdmission(t *testing.T, f settlementFixture, perBuild, perDay int) {
	t.Helper()
	_, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET max_calls = $2, max_calls_per_day = $3
		WHERE source_id = $1`, f.res.SourceID, perBuild, perDay)
	if err != nil {
		t.Fatal(err)
	}
}

func anotherAdmissionProfile(t *testing.T, f settlementFixture) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := f.pool.Exec(t.Context(), `INSERT INTO embedding_profiles
		(id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		SELECT $1, $2, 'Admission candidate', model_id, dimensions, storage_type, chunk_size, chunk_overlap
		FROM embedding_profiles WHERE id = $3`, id, "candidate-"+id.String(), f.res.ProfileID)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPGBuildFanoutSharesSourceDailyAdmission(t *testing.T) {
	f := newSettlementFixture(t)
	configureCallAdmission(t, f, 2, 1)
	r := f.res
	r.Cap = 2
	if _, err := f.store.Reserve(t.Context(), r); err != nil {
		t.Fatal(err)
	}
	r.ProfileID = anotherAdmissionProfile(t, f)
	if _, err := f.store.Reserve(t.Context(), r); !errors.Is(err, ErrCapReached) {
		t.Fatalf("parallel build bypassed the source daily cap: got %v, want cap reached", err)
	}
}

func TestPGCallerSinceCannotResetDailyAdmission(t *testing.T) {
	f := newSettlementFixture(t)
	configureCallAdmission(t, f, 2, 1)
	r := f.res
	r.Phase, r.Cap = PhaseLive, 1
	now := time.Now().UTC()
	r.Since = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if _, err := f.store.Reserve(t.Context(), r); err != nil {
		t.Fatal(err)
	}
	r.Since = r.Since.Add(24 * time.Hour)
	if _, err := f.store.Reserve(t.Context(), r); !errors.Is(err, ErrCapReached) {
		t.Fatalf("caller-supplied Since reset daily admission: got %v, want cap reached", err)
	}
}

func TestPGCandidateDeletionCannotResetDailyAdmission(t *testing.T) {
	f := newSettlementFixture(t)
	configureCallAdmission(t, f, 2, 1)
	r := f.res
	r.Phase, r.Cap = PhaseLive, 1
	now := time.Now().UTC()
	r.Since = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	r.ProfileID = anotherAdmissionProfile(t, f)
	if _, err := f.store.Reserve(t.Context(), r); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `DELETE FROM embedding_profiles WHERE id = $1`, r.ProfileID); err != nil {
		t.Fatal(err)
	}
	r.ProfileID = f.res.ProfileID
	if _, err := f.store.Reserve(t.Context(), r); !errors.Is(err, ErrCapReached) {
		t.Fatalf("candidate deletion erased daily admission history: got %v, want cap reached", err)
	}
}
