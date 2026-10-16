package gaps_test

import "testing"

// TestRouterQuestionsAreEmbeddedInTheDefaultProfile: a router has no knowledge bases to take an embedding profile from
// (docs/specs/v0.6.0/DESIGN.md §4), so a question that fits no agent is embedded in the platform's default profile and
// grouped like any other. An agent with knowledge bases keeps its own profile.
func TestRouterQuestionsAreEmbeddedInTheDefaultProfile(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE embedding_profiles SET is_default = true WHERE id = $1`, f.profile)
	router := f.id(`INSERT INTO agents (team_id, slug, name) VALUES ($1, 'door', 'Front door') RETURNING id`, f.team)
	version := f.id(`INSERT INTO agent_versions (agent_id, version, config, chat_model_id, effective_rank)
		SELECT $1, 1, '{"router": true}', chat_model_id, 0 FROM agent_versions LIMIT 1 RETURNING id`, router)
	f.exec(`UPDATE agents SET published_version_id = $1 WHERE id = $2`, version, router)
	conv := f.ask("a1", "NOAGENT Who won the football game?", false, "no_agent")
	f.exec(`UPDATE gap_questions SET agent_id = $1 WHERE conversation_id = $2`, router, conv)

	f.run()
	var embedded bool
	var profile string
	if err := f.pool.QueryRow(f.ctx, `SELECT embedding IS NOT NULL, coalesce(profile_id::text, '') FROM gap_questions WHERE conversation_id = $1`, conv).Scan(&embedded, &profile); err != nil {
		t.Fatal(err)
	}
	if !embedded || profile != f.profile.String() {
		t.Errorf("the router's question: embedded %v in profile %q, want the default %s", embedded, profile, f.profile)
	}
	if n := f.count(`SELECT count(*) FROM gap_topics WHERE agent_id = $1`, router); n != 1 {
		t.Errorf("the router has %d gap topics, want 1", n)
	}
}
