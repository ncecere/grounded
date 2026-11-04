package httpapi_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestAssistantAboutPublishedProjection(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Disclosed assistant")
	anon := newVisitor(t, env.app.URL)
	path := "/v1/public/agents/" + pub.Id.String()
	var got apitypes.PublicAgent
	if code, e := anon.call("GET", path, nil, &got); code != 200 || got.About == nil {
		t.Fatalf("about = %d %s %+v", code, e, got)
	}
	if got.About.OwnershipNote != "" || got.About.SourceCount != 1 || got.About.LastProcessedAt == nil {
		t.Fatalf("defaults %+v", got.About)
	}
	editPath := env.base + "/agents/" + pub.Id.String()
	var current apitypes.Agent
	env.editor.get(editPath, &current)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["audience"] = "public"
	cfg["ownershipNote"] = "PRIVATE-DRAFT-NOTE"
	code, e := env.editor.call("PATCH", editPath, map[string]any{"config": cfg}, nil, ifMatch(current.Revision))
	mustCode(t, "save private note", code, e, 200, "")
	code, e = env.editor.call("PATCH", editPath, map[string]any{"config": cfg}, nil, ifMatch(current.Revision))
	mustCode(t, "stale revision", code, e, 412, "")
	for name, s := range map[string]*session{"member": env.member, "editor": env.editor, "owner": env.owner, "admin": env.admin, "auditor": env.auditor} {
		var card apitypes.AgentCard
		code := s.get("/v1/agents/id/"+pub.Id.String(), &card)
		if code != 200 || card.About == nil || card.About.OwnershipNote != "" {
			t.Errorf("%s profile = %d %+v", name, code, card.About)
		}
	}
	got = apitypes.PublicAgent{}
	anon.call("GET", path, nil, &got)
	if got.About == nil || got.About.OwnershipNote != "" {
		t.Fatal("draft published silently")
	}
	if code, raw := env.publish(env.tadmin, pub); code != 201 {
		t.Fatalf("publish %d %s", code, raw)
	}
	got = apitypes.PublicAgent{}
	anon.call("GET", path, nil, &got)
	if got.About == nil || got.About.OwnershipNote != "PRIVATE-DRAFT-NOTE" {
		t.Fatalf("published note %+v", got.About)
	}
	// No chat/model requests or jobs are produced by repeated profile reads.
	chats := len(env.proxy.ChatRequests())
	embeds := env.proxy.EmbedRequestsFor("bow-64")
	jobs := env.scalar(t, "SELECT count(*) FROM river_job")
	for range 3 {
		anon.call("GET", path, nil, nil)
	}
	if len(env.proxy.ChatRequests()) != chats || env.proxy.EmbedRequestsFor("bow-64") != embeds || env.scalar(t, "SELECT count(*) FROM river_job") != jobs {
		t.Fatal("profile read caused work")
	}
	// Public projection never serializes connection/config/source identifiers.
	_, raw := anon.do("GET", path, nil, nil)
	for _, secret := range []string{env.kb.Id.String(), env.upload.Id.String(), env.conn.Id.String(), "chatModelId", "instructions", "upstreamModel", "extraBody"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("projection contains %q", secret)
		}
	}
	// The aggregation stops at 501 source rows and withholds incomplete freshness.
	if _, err := env.app.Pool.Exec(context.Background(), `WITH added AS (
 INSERT INTO data_sources(team_id,name,type,classification,embedding_profile_id)
 SELECT team_id, 'Bounded source ' || n, type, classification, embedding_profile_id
 FROM data_sources CROSS JOIN generate_series(1,501) n WHERE id=$1 RETURNING id)
 INSERT INTO kb_sources(kb_id,source_id) SELECT $2,id FROM added`, env.upload.Id, env.kb.Id); err != nil {
		t.Fatal(err)
	}
	got = apitypes.PublicAgent{}
	anon.call("GET", path, nil, &got)
	if got.About == nil || got.About.SourceCount != 500 || !got.About.SourcesLimited || got.About.LastProcessedAt != nil {
		t.Fatalf("bounded aggregate %+v", got.About)
	}

	// A kill switch retains the legacy disabled profile but withholds the card.
	code, e = env.tadmin.call("POST", editPath+"/status", map[string]any{"status": "disabled_by_team"}, nil, nil)
	mustCode(t, "disable", code, e, 200, "")
	got = apitypes.PublicAgent{}
	anon.call("GET", path, nil, &got)
	if got.About != nil {
		t.Fatal("disabled agent has About")
	}
	env.setPublic(t, false)
	if code, _ := anon.call("GET", path, nil, nil); code != 503 {
		t.Fatalf("revocation = %d", code)
	}
	// Restore the platform switch, then revoke publication in the fixture itself.
	env.setPublic(t, true)
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE agents SET published_version_id=NULL WHERE id=$1`, pub.Id); err != nil {
		t.Fatal(err)
	}
	if code, _ := anon.call("GET", path, nil, nil); code != 404 {
		t.Fatalf("unpublished profile = %d", code)
	}
	if code := env.member.get("/v1/agents/id/"+pub.Id.String(), nil); code != 404 {
		t.Fatalf("unpublished signed-in profile = %d", code)
	}
	// A private team agent remains unavailable to foreign platform staff as content readers.
	private := env.publishAgent(t, "Private helper", env.agentConfig(env.kb.Id.String()))
	for _, s := range []*session{env.admin, env.auditor} {
		if code := s.get("/v1/agents/id/"+private.Id.String(), nil); code != 404 {
			t.Fatalf("foreign staff private profile = %d", code)
		}
	}
	if code, _ := anon.call("GET", "/v1/public/agents/"+private.Id.String(), nil, nil); code != 404 {
		t.Fatalf("anonymous private profile = %d", code)
	}

}
