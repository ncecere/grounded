package httpapi_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

const statusReady = apitypes.ProfileMigrationStatus("ready")

// held starts a migration that stops before its switch (index preview, #18).
func (env *migEnv) held(t *testing.T, kbID, profileID uuid.UUID) apitypes.ProfileMigration {
	t.Helper()
	var m apitypes.ProfileMigration
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations", map[string]any{"kbId": kbID, "targetProfileId": profileID, "hold": true}, &m, nil)
	mustCode(t, "start a held migration", code, e, 201, "")
	return m
}

// A held migration builds the new index and then waits: the KB keeps answering from the live profile, the candidate is not cleaned up while it
// is being looked at, and an admin's switch does what the automatic one does (#18, index preview).
func TestProfileMigrationHoldBeforeSwitch(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))})
	kb := env.kb(t, "Handbook", src.Id)
	livePassages := env.chunks(t, src.Id, env.from.Id)

	m := env.held(t, kb.Id, env.wide.Id)
	m = env.waitStatus(t, m.Id, statusReady)

	// Built, not switched.
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.from.Id {
		t.Fatalf("a held migration switched the KB to %s", got)
	}
	if env.sourceProfile(t, src.Id) != env.from.Id {
		t.Error("a held migration moved the source's profile")
	}
	built := env.chunks(t, src.Id, env.wide.Id)
	if built == 0 || env.vectors(t, src.Id, env.wide.Id) != built {
		t.Fatalf("the candidate index was not built: %d passages, %d vectors", built, env.vectors(t, src.Id, env.wide.Id))
	}
	if env.chunks(t, src.Id, env.from.Id) != livePassages {
		t.Error("the live index changed while the candidate was built")
	}

	// Queries still use the live profile: the candidate's model is not asked to embed them.
	askedBefore := env.proxy.EmbedRequestsFor("mrl-2560")
	if hits := env.retrieve(t, kb.Id, "parking permits deadlines"); !anyHit(hits, "Parking") {
		t.Fatalf("hits while a preview is held: %d", len(hits))
	}
	if env.proxy.EmbedRequestsFor("mrl-2560") != askedBefore {
		t.Error("a query was embedded with the candidate's model before the switch")
	}

	// The cleanup job must not delete what is being previewed (it keeps the sets of running and switched migrations; a ready one needs them too).
	env.cleanup(t)
	if env.chunks(t, src.Id, env.wide.Id) != built || env.vectors(t, src.Id, env.wide.Id) != built {
		t.Fatalf("the cleanup job deleted the candidate index: %d passages, %d vectors left of %d", env.chunks(t, src.Id, env.wide.Id), env.vectors(t, src.Id, env.wide.Id), built)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'kb.profile_preview_ready'`); n != 1 {
		t.Errorf("ready audit entries = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'kb.profile_switch'`); n != 0 {
		t.Errorf("switch audit entries before the switch = %d", n)
	}

	// Only an admin decides.
	code, e := env.owner.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/switch", nil, nil, ifMatch(m.Revision))
	mustCode(t, "member switch", code, e, 403, "")

	// The switch is the automatic one's: the KB and its source move, the migration is in its grace period, the team is told.
	sw := env.action(t, m, "switch", 200, "")
	if sw.Status != apitypes.ProfileMigrationStatusSwitched || !sw.CanSwitchBack {
		t.Fatalf("after the switch: %+v", sw)
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.wide.Id {
		t.Fatalf("kb profile after the switch = %s", got)
	}
	if env.sourceProfile(t, src.Id) != env.wide.Id {
		t.Error("the source did not move with its only KB")
	}
	if hits := env.retrieve(t, kb.Id, "parking permits deadlines"); !anyHit(hits, "Parking") {
		t.Fatalf("hits after the switch: %d", len(hits))
	}
	if env.proxy.EmbedRequestsFor("mrl-2560") == askedBefore {
		t.Error("after the switch the target model was never used for a query")
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'kb.profile_switch'`); n != 1 {
		t.Errorf("switch audit entries = %d", n)
	}
	// The admin who switched is on record (the automatic switch is the system's).
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'kb.profile_switch' AND actor_kind = 'user' AND actor_user_id IS NOT NULL`); n != 1 {
		t.Errorf("switch audit entries by a user = %d", n)
	}
	for _, result := range []string{"ready", "switched"} {
		if n := env.scalar(t, `SELECT count(*) FROM notifications n JOIN notification_events e ON e.id = n.event_id
			WHERE n.type = 'platform.profile_migration' AND e.data->>'result' = $1`, result); n != 1 {
			t.Errorf("admin notifications %q = %d", result, n)
		}
	}
	// It cannot be switched twice, and switching back works as for any migration.
	env.action(t, sw, "switch", 409, "migration_not_ready")
	env.action(t, sw, "switch-back", 200, "")
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.from.Id {
		t.Errorf("kb profile after switching back = %s", got)
	}
}

// Discarding a held migration removes the candidate and leaves the live index untouched, and frees the KB for another migration.
func TestProfileMigrationHoldCancelDiscardsTheCandidate(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"parking.md", []byte(longText("Parking permits", 40))})
	kb := env.kb(t, "Handbook", src.Id)
	livePassages := env.chunks(t, src.Id, env.from.Id)

	m := env.held(t, kb.Id, env.wide.Id)
	m = env.waitStatus(t, m.Id, statusReady)
	if env.chunks(t, src.Id, env.wide.Id) == 0 {
		t.Fatal("the candidate was not built")
	}
	// Another migration of the KB is refused while one is held, and says why.
	blocked := env.preflight(t, kb.Id, env.wide.Id)
	if len(blocked.Blockers) != 1 || blocked.Blockers[0].Code != "migration_active" || !strings.Contains(blocked.Blockers[0].Message, "waiting to be switched") {
		t.Fatalf("blockers while a migration is held = %+v", blocked.Blockers)
	}
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations", map[string]any{"kbId": kb.Id, "targetProfileId": env.wide.Id}, nil, nil)
	mustCode(t, "second migration while one is held", code, e, 409, "migration_blocked")

	cancelled := env.action(t, m, "cancel", 200, "")
	if cancelled.Status != apitypes.ProfileMigrationStatusCancelled {
		t.Fatalf("after cancel: %+v", cancelled)
	}
	// A discarded migration cannot be switched.
	env.action(t, cancelled, "switch", 409, "migration_not_ready")
	env.cleanup(t)
	if env.chunks(t, src.Id, env.wide.Id) != 0 || env.vectors(t, src.Id, env.wide.Id) != 0 {
		t.Errorf("the candidate was not removed: %d passages, %d vectors", env.chunks(t, src.Id, env.wide.Id), env.vectors(t, src.Id, env.wide.Id))
	}
	if env.chunks(t, src.Id, env.from.Id) != livePassages {
		t.Error("discarding the candidate changed the live index")
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.from.Id {
		t.Errorf("kb profile = %s", got)
	}
	// The KB is free again.
	again := env.start(t, kb.Id, env.wide.Id, nil)
	env.waitStatus(t, again.Id, apitypes.ProfileMigrationStatusSwitched)
}

// A migration started without hold switches by itself, as it always has (the existing tests cover its details); a held one can only be switched
// when it is ready.
func TestProfileMigrationSwitchNeedsAReadyMigration(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"parking.md", []byte(longText("Parking permits", 40))})
	kb := env.kb(t, "Handbook", src.Id)
	m := env.start(t, kb.Id, env.wide.Id, nil)
	m = env.waitStatus(t, m.Id, apitypes.ProfileMigrationStatusSwitched)
	env.action(t, m, "switch", 409, "migration_not_ready")
}

// A document that changed after the migration became ready has no vectors in the new index yet. Switching then would lose it from search, so the
// switch refuses (the sweep embeds it) and the migration stays ready, the KB on its live profile.
func TestProfileMigrationSwitchWaitsForDocumentsThatChanged(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))})
	kb := env.kb(t, "Handbook", src.Id)
	m := env.held(t, kb.Id, env.wide.Id)
	m = env.waitStatus(t, m.Id, statusReady)

	// Simulate a document the sweep has not embedded for the new profile yet.
	if n, err := env.app.Pool.Exec(context.Background(), `DELETE FROM chunks WHERE profile_id = $1 AND document_id = (
		SELECT document_id FROM chunks WHERE profile_id = $1 AND source_id = $2 LIMIT 1)`, env.wide.Id, src.Id); err != nil || n.RowsAffected() == 0 {
		t.Fatalf("removing one document's new vectors: %v, %d rows", err, n.RowsAffected())
	}
	env.action(t, m, "switch", 409, "migration_catching_up")
	again := env.migration(t, m.Id)
	if again.Status != statusReady || again.Revision != m.Revision {
		t.Errorf("a refused switch changed the migration: %+v", again)
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.from.Id {
		t.Errorf("kb profile after a refused switch = %s", got)
	}
}
