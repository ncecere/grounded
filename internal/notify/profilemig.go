// Profile migration events (docs/phase5-deploy.md §5 P2): platform admins
// hear when a knowledge base switched or documents failed to move; the
// team's admins and owners hear when their knowledge base changed profile.

package notify

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Migrations are a tab of Admin → Embedding profiles (v0.2.1 I1); the old
// /admin/profile-migrations links of stored notifications redirect there.
func migrationLink(id uuid.UUID) string {
	return "/admin/embedding-profiles?tab=migrations&record=" + id.String()
}

// ProfileSwitchedEvent: a migration switched its knowledge base.
func ProfileSwitchedEvent(admins []uuid.UUID, t TeamRef, migrationID uuid.UUID, kbName, from, to string, until time.Time) Event {
	body := fmt.Sprintf("The knowledge base %s (%s) now searches the embedding profile %s instead of %s.", kbName, t.Name, to, from)
	if until.After(time.Now()) {
		body += fmt.Sprintf(" The old vectors are kept until %s, so you can switch back until then.", day(until))
	} else {
		body += " The old vectors are being deleted."
	}
	return Event{
		Type: ProfileMigration, TeamID: t.ID, Users: admins, Link: migrationLink(migrationID),
		DedupeKey: "profile_switched:" + migrationID.String(),
		Title:     fmt.Sprintf("Profile migration switched: %s (%s)", kbName, t.Name),
		Body:      body,
		Data:      map[string]any{"team": t.Slug, "migrationId": migrationID, "result": "switched"},
	}
}

// ProfileAttentionEvent: documents of a running migration failed; it
// can't switch until they are retried (or removed).
func ProfileAttentionEvent(admins []uuid.UUID, t TeamRef, migrationID uuid.UUID, kbName, to string, failed int64, at time.Time) Event {
	return Event{
		Type: ProfileMigration, TeamID: t.ID, Users: admins, Link: migrationLink(migrationID),
		DedupeKey: "profile_attention:" + migrationID.String() + ":" + at.UTC().Format(time.RFC3339),
		Title:     fmt.Sprintf("Profile migration needs attention: %s (%s)", kbName, t.Name),
		Body: fmt.Sprintf("%d documents of %s couldn't be embedded for %s, so the knowledge base can't switch yet. "+
			"It keeps searching its current profile. See the errors, then retry them under Admin, Profile migrations.", failed, kbName, to),
		Data: map[string]any{"team": t.Slug, "migrationId": migrationID, "result": "attention", "failed": failed},
	}
}

// KBProfileChangedEvent: a team's knowledge base moved to another profile
// (back: switched back to its previous one).
func KBProfileChangedEvent(t TeamRef, kbID uuid.UUID, kbName, from, to string, back bool) Event {
	title := fmt.Sprintf("%s now uses the embedding profile %s (%s)", kbName, to, t.Name)
	body := fmt.Sprintf("A platform admin moved the knowledge base %s from %s to %s. Search and agents use the new profile now; nothing else changes.", kbName, from, to)
	if back {
		body = fmt.Sprintf("A platform admin switched the knowledge base %s back from %s to %s. Search and agents use it again now.", kbName, from, to)
	}
	return Event{
		Type: KBProfileChanged, TeamID: t.ID, Link: t.path("/kbs/" + kbID.String()),
		Title: title, Body: body,
		Data: map[string]any{"team": t.Slug, "kbId": kbID, "from": from, "to": to, "back": back},
	}
}
