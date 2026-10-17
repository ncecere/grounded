package httpapi_test

import (
	"context"
	"testing"
)

// A shared link is its owner's: it works while the owner is an active person who can still chat with the agent, and no longer once they leave the
// team, are suspended or lose access (QA pass v0.6.0, #141). The owner used to open their own link whatever had happened to them, and a link open
// to anyone kept working for everybody.
func TestSharedLinkEndsWhenItsOwnerCanNoLongerUseTheAgent(t *testing.T) {
	env := newShareEnv(t)
	opens := func(label string, s *session, token string, want int) {
		t.Helper()
		if code, _, e := env.view(s, token); code != want {
			t.Errorf("%s: %d %s, want %d", label, code, e, want)
		}
	}

	// A team's own agent: the link is for the agent's users.
	team := env.publishAgent(t, "Team only help", env.agentConfig(env.kb.Id.String()))
	conv := env.ask(t, env.member, team.Slug, "", "Where do students buy a parking permit?")
	link := env.share(t, env.member, conv, "agent_users", false)
	opens("baseline: a colleague", env.editor, link.Token, 200)
	opens("baseline: the owner of the link", env.member, link.Token, 200)

	// The owner leaves the team: nobody opens it, not even the owner (who has no access to the agent now).
	memberID := env.member.me.User.Id.String()
	code, e := env.owner.call("DELETE", env.base+"/members/"+memberID, nil, nil, nil)
	mustCode(t, "remove the owner of the link from the team", code, e, 200, "")
	opens("a colleague, the owner left the team", env.editor, link.Token, 404)
	opens("the owner, who left the team", env.member, link.Token, 404)
	// The people who made it can still manage links they made while they could: listing and revoking are theirs (not this gate).

	// A public agent: a link open to anyone is the owner's too. Suspended, it closes for everybody; reactivated, it opens again.
	pub := env.publicAgent(t, "Open help")
	pconv := env.ask(t, env.editor, pub.Slug, "", "Where do students buy a parking permit?")
	forUsers := env.share(t, env.editor, pconv, "agent_users", false)
	anyone := env.share(t, env.editor, pconv, "anyone", false)
	opens("baseline, public: the auditor", env.auditor, forUsers.Token, 200)
	if code, _, e := env.viewAnon(anyone.Token); code != 200 {
		t.Fatalf("baseline: anonymous opens an anyone link = %d %s", code, e)
	}
	setStatus := func(status string) {
		t.Helper()
		if _, err := env.app.Pool.Exec(context.Background(), "UPDATE users SET status = $1 WHERE id = $2::uuid", status, env.editor.me.User.Id.String()); err != nil {
			t.Fatal(err)
		}
	}
	setStatus("suspended")
	opens("a person, the owner is suspended", env.auditor, forUsers.Token, 404)
	if code, _, e := env.viewAnon(anyone.Token); code != 401 || e != "sign_in_required" {
		t.Errorf("anonymous, the owner is suspended: %d %s, want 401 sign_in_required", code, e)
	}
	setStatus("active")
	opens("a person, the owner is active again", env.auditor, forUsers.Token, 200)
	if code, _, e := env.viewAnon(anyone.Token); code != 200 {
		t.Errorf("anonymous, the owner is active again: %d %s, want 200", code, e)
	}
}
