package httpapi_test

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// preview starts an index preview of a knowledge base with changed settings (hidden candidate profile, held migration).
func (env *migEnv) preview(t *testing.T, kb uuid.UUID, changes map[string]any) apitypes.ProfileMigration {
	t.Helper()
	var m apitypes.ProfileMigration
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb, "changes": changes}, &m, nil)
	mustCode(t, "preview", code, e, 201, "")
	return m
}

func (env *migEnv) profileRows(t *testing.T) int64 {
	return env.scalar(t, `SELECT count(*) FROM embedding_profiles`)
}

func (env *migEnv) tableExists(t *testing.T, profile uuid.UUID) bool {
	return env.scalar(t, `SELECT CASE WHEN to_regclass($1) IS NULL THEN 0 ELSE 1 END`, "emb_"+strings.ReplaceAll(profile.String(), "-", "")) == 1
}

func (env *migEnv) profileByID(t *testing.T, id uuid.UUID) apitypes.EmbeddingProfile {
	t.Helper()
	var p apitypes.EmbeddingProfile
	if code := env.admin.get("/v1/admin/embedding-profiles/"+id.String(), &p); code != 200 {
		t.Fatalf("get profile %s = %d", id, code)
	}
	return p
}

// listedEverywhere reports whether the profile is in the admin list or the pickers.
func (env *migEnv) listedEverywhere(t *testing.T, id uuid.UUID) (admin, picker bool) {
	t.Helper()
	var all []apitypes.EmbeddingProfile
	if code := env.admin.get("/v1/admin/embedding-profiles", &all); code != 200 {
		t.Fatalf("admin list = %d", code)
	}
	for _, p := range all {
		admin = admin || p.Id == id
	}
	var opts []struct {
		Id uuid.UUID `json:"id"`
	}
	if code := env.owner.get("/v1/embedding-profiles", &opts); code != 200 {
		t.Fatalf("picker list = %d", code)
	}
	for _, o := range opts {
		picker = picker || o.Id == id
	}
	return
}

// An index preview builds the new index into a hidden copy of the profile while the live one keeps answering. The copy is in no list or
// picker, cannot be chosen, edited or deleted, and a refused preview leaves no copy behind (#18, T2).
func TestProfilePreviewMakesAHiddenCandidate(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))})
	kb := env.kb(t, "Handbook", src.Id)
	livePassages := env.chunks(t, src.Id, env.from.Id)
	rowsBefore := env.profileRows(t)

	// Only platform admins preview.
	code, e := env.owner.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": map[string]any{"chunkSize": 256}}, nil, nil)
	mustCode(t, "member preview", code, e, 403, "")
	// A change the profile does not allow is refused before anything is made.
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": map[string]any{"chunkSize": 70, "chunkOverlap": 80}}, nil, nil)
	mustCode(t, "invalid change", code, e, 400, "invalid_chunk_overlap")
	if env.profileRows(t) != rowsBefore {
		t.Fatalf("a refused preview left a profile: %d -> %d", rowsBefore, env.profileRows(t))
	}

	m := env.preview(t, kb.Id, map[string]any{"chunkSize": 256, "chunkOverlap": 32, "name": "Handbook, long passages"})
	cand := m.ToProfile.Id
	if cand == env.from.Id || m.FromProfile.Id != env.from.Id || !m.Hold {
		t.Fatalf("preview migration = %+v", m)
	}
	m = env.waitStatus(t, m.Id, statusReady)

	// The copy: the live profile's settings with the changes, hidden, never the default.
	p := env.profileByID(t, cand)
	if p.CandidateOf == nil || *p.CandidateOf != env.from.Id || p.IsDefault || p.Status != apitypes.EmbeddingProfileStatusActive ||
		p.ChunkSize != 256 || p.ChunkOverlap != 32 || p.Name != "Handbook, long passages" || !strings.HasPrefix(p.Key, "preview-") ||
		p.Model.Id != env.from.Model.Id || p.DocumentPrefix != env.from.DocumentPrefix || p.StorageType != env.from.StorageType {
		t.Fatalf("candidate = %+v (live %+v)", p, env.from)
	}
	if env.profileRows(t) != rowsBefore+1 {
		t.Errorf("profiles: %d -> %d, want one more", rowsBefore, env.profileRows(t))
	}

	// Hidden: the admin list, the pickers and the command palette.
	if admin, picker := env.listedEverywhere(t, cand); admin || picker {
		t.Errorf("candidate listed: admin %v, picker %v", admin, picker)
	}
	var raw json.RawMessage
	if code := env.admin.get("/v1/search?q="+url.QueryEscape("long passages"), &raw); code != 200 || strings.Contains(string(raw), cand.String()) {
		t.Errorf("search = %d, finds the candidate: %v", code, strings.Contains(string(raw), cand.String()))
	}
	// Not selectable by a knowledge base, even for someone who knows its id.
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Sneaky", "embeddingProfileId": cand}, nil, nil)
	mustCode(t, "kb on a candidate", code, e, 400, "unknown_profile")
	// Not editable or deletable through the profile API.
	code, e = env.admin.call("PATCH", "/v1/admin/embedding-profiles/"+cand.String(), map[string]any{"name": "Renamed"}, nil, ifMatch(p.Revision))
	mustCode(t, "patch a candidate", code, e, 409, "profile_is_candidate")
	code, e = env.admin.call("DELETE", "/v1/admin/embedding-profiles/"+cand.String(), nil, nil, nil)
	mustCode(t, "delete a candidate", code, e, 409, "profile_is_candidate")

	// Built beside the live index with the new passage size; the live one is untouched and still answers.
	built := env.chunks(t, src.Id, cand)
	if built == 0 || built >= livePassages || env.vectors(t, src.Id, cand) != built { // longer passages: fewer of them
		t.Fatalf("candidate index: %d passages (live %d), %d vectors", built, livePassages, env.vectors(t, src.Id, cand))
	}
	if env.chunks(t, src.Id, env.from.Id) != livePassages {
		t.Error("the live index changed while the candidate was built")
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.from.Id {
		t.Fatalf("kb profile = %s", got)
	}
	if hits := env.retrieve(t, kb.Id, "parking permits deadlines"); !anyHit(hits, "Parking") {
		t.Fatalf("hits while a preview is held: %d", len(hits))
	}

	// A second preview of the same knowledge base is refused with the reason, and leaves no copy behind.
	rows := env.profileRows(t)
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": map[string]any{"chunkSize": 192}}, nil, nil)
	mustCode(t, "second preview", code, e, 409, "migration_blocked")
	if env.profileRows(t) != rows {
		t.Errorf("a refused preview left a profile behind: %d -> %d", rows, env.profileRows(t))
	}
}

// Discarding a preview deletes the candidate's passages and vector table and retires its hidden profile; the migration's record and the live
// index stay, and the knowledge base can be previewed again (D8: a profile with migration history is never deleted).
func TestProfilePreviewDiscardRetiresTheCandidate(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"parking.md", []byte(longText("Parking permits", 40))})
	kb := env.kb(t, "Handbook", src.Id)
	livePassages := env.chunks(t, src.Id, env.from.Id)

	m := env.preview(t, kb.Id, map[string]any{"chunkSize": 256, "chunkOverlap": 32})
	cand := m.ToProfile.Id
	m = env.waitStatus(t, m.Id, statusReady)
	if !env.tableExists(t, cand) || env.chunks(t, src.Id, cand) == 0 {
		t.Fatal("the candidate index was not built")
	}

	cancelled := env.action(t, m, "cancel", 200, "")
	if cancelled.Status != apitypes.ProfileMigrationStatusCancelled {
		t.Fatalf("after discard: %+v", cancelled)
	}
	env.cleanup(t)

	if n := env.chunks(t, src.Id, cand); n != 0 {
		t.Errorf("candidate passages left: %d", n)
	}
	if env.tableExists(t, cand) {
		t.Error("the candidate's vector table was not dropped")
	}
	p := env.profileByID(t, cand) // retired, not deleted
	if p.Status != apitypes.EmbeddingProfileStatusRetired || p.CandidateOf == nil {
		t.Errorf("discarded candidate = status %s, candidateOf %v", p.Status, p.CandidateOf)
	}
	if admin, picker := env.listedEverywhere(t, cand); admin || picker {
		t.Errorf("a retired candidate is listed: admin %v, picker %v", admin, picker)
	}
	// The record stays, and names the candidate.
	rec := env.migration(t, m.Id)
	if rec.Status != apitypes.ProfileMigrationStatusCancelled || rec.ToProfile.Id != cand {
		t.Errorf("record = %+v", rec)
	}
	// The live index is untouched, and the knowledge base is free for another preview.
	if env.chunks(t, src.Id, env.from.Id) != livePassages || env.getKB(t, kb.Id).EmbeddingProfileId != env.from.Id {
		t.Error("discarding changed the live index")
	}
	again := env.preview(t, kb.Id, map[string]any{"chunkSize": 192, "chunkOverlap": 24})
	env.waitStatus(t, again.Id, statusReady)
}

// Switching a preview makes its candidate an ordinary profile: listed, selectable, and the knowledge base's.
func TestProfilePreviewSwitchMakesTheCandidateOrdinary(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"parking.md", []byte(longText("Parking permits", 40))})
	kb := env.kb(t, "Handbook", src.Id)

	m := env.preview(t, kb.Id, map[string]any{"chunkSize": 256, "chunkOverlap": 32})
	cand := m.ToProfile.Id
	m = env.waitStatus(t, m.Id, statusReady)
	sw := env.action(t, m, "switch", 200, "")
	if sw.Status != apitypes.ProfileMigrationStatusSwitched {
		t.Fatalf("after the switch: %+v", sw)
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != cand {
		t.Fatalf("kb profile = %s, want the candidate %s", got, cand)
	}
	p := env.profileByID(t, cand)
	if p.CandidateOf != nil || p.Status != apitypes.EmbeddingProfileStatusActive {
		t.Errorf("switched candidate = candidateOf %v, status %s", p.CandidateOf, p.Status)
	}
	if admin, picker := env.listedEverywhere(t, cand); !admin || !picker {
		t.Errorf("a switched candidate is not listed: admin %v, picker %v", admin, picker)
	}
	// And it can be edited like any profile now.
	var renamed apitypes.EmbeddingProfile
	code, e := env.admin.call("PATCH", "/v1/admin/embedding-profiles/"+cand.String(), map[string]any{"name": "Handbook passages"}, &renamed, ifMatch(p.Revision))
	mustCode(t, "rename a switched candidate", code, e, 200, "")
	// Switching back leaves it an ordinary profile.
	env.action(t, sw, "switch-back", 200, "")
	if admin, _ := env.listedEverywhere(t, cand); !admin {
		t.Error("after switching back the profile is hidden again")
	}
}

// A preview keeps the live profile's dimension truncation with the same model, and drops it with another (a new model has its own
// dimensions): the 768-dimension profile of the 2560-dimension model, previewed with new passage sizes and then with a 48-dimension model.
func TestProfilePreviewKeepsTruncationOnlyWithTheSameModel(t *testing.T) {
	env := newMigEnv(t)
	var kb apitypes.KnowledgeBase
	code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Wide", "embeddingProfileId": env.wide.Id}, &kb, nil)
	mustCode(t, "kb on the wide profile", code, e, 201, "")

	same := env.preview(t, kb.Id, map[string]any{"chunkSize": 512, "chunkOverlap": 64})
	p := env.profileByID(t, same.ToProfile.Id)
	if p.Model.Id != env.wide.Model.Id || p.Dimensions != 768 {
		t.Errorf("same model: model %s, %d dimensions (the live profile's 768 truncation should stay)", p.Model.Id, p.Dimensions)
	}
	env.action(t, env.waitStatus(t, same.Id, statusReady), "cancel", 200, "")

	other := env.preview(t, kb.Id, map[string]any{"modelId": env.twin.Model.Id})
	q := env.profileByID(t, other.ToProfile.Id)
	if q.Model.Id != env.twin.Model.Id || q.Dimensions != 48 {
		t.Errorf("another model: model %s, %d dimensions (its own 48)", q.Model.Id, q.Dimensions)
	}
}
