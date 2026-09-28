package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Embedding profiles that store fewer dimensions than their model
// (outputDimensions, DESIGN.md §10), through both the dimensions parameter
// and client-side truncation, and fusion defaults per profile (§6).
func TestOutputDimensionsAndProfileFusion(t *testing.T) {
	env := newRAGEnv(t)
	admin, owner := env.admin, env.owner
	env.proxy.AddEmbeddingModel("plain-2560", 2560)
	env.proxy.AddMatryoshkaEmbeddingModel("mrl-2560", 2560)
	var conns []apitypes.Connection
	admin.get("/v1/admin/connections", &conns)

	model := func(key, upstream string, compat map[string]any) apitypes.Model {
		var m apitypes.Model
		code, e := admin.call("POST", "/v1/admin/models", map[string]any{
			"connectionId": conns[0].Id, "key": key, "upstreamModel": upstream, "displayName": key, "kind": "embedding",
			"maxClassification": "restricted", "dimensions": 2560, "compat": compat,
		}, &m, nil)
		mustCode(t, "model "+key, code, e, 201, "")
		return m
	}
	plain := model("plain", "plain-2560", nil)
	mrl := model("mrl", "mrl-2560", map[string]any{"supportsDimensionsParam": true, "extraBody": map[string]any{"x": 1}})
	if mrl.Compat.SupportsDimensionsParam == nil || !*mrl.Compat.SupportsDimensionsParam || mrl.Compat.ExtraBody != nil {
		t.Fatalf("embedding compat = %+v", mrl.Compat)
	}

	profile := func(key string, m apitypes.Model, extra map[string]any, wantCode int, wantErr string) apitypes.EmbeddingProfile {
		body := map[string]any{"key": key, "name": key, "modelId": m.Id, "chunkSize": 128, "chunkOverlap": 16,
			"queryPrefix": "Instruct: Given a question, retrieve passages that answer it\nQuery: "}
		for k, v := range extra {
			body[k] = v
		}
		var p apitypes.EmbeddingProfile
		code, e := admin.call("POST", "/v1/admin/embedding-profiles", body, &p, nil)
		mustCode(t, "profile "+key, code, e, wantCode, wantErr)
		return p
	}
	profile("too-many", plain, map[string]any{"outputDimensions": 4000}, 400, "invalid_output_dimensions")
	profile("zero", plain, map[string]any{"outputDimensions": 0}, 400, "invalid_output_dimensions")
	profile("vector-2560", plain, map[string]any{"storageType": "vector"}, 400, "dimensions_too_large")
	profile("bad-weights", plain, map[string]any{"outputDimensions": 768, "defaultFusionWeights": map[string]any{"vector": 0, "keyword": 0}}, 400, "invalid_fusion_weights")
	truncated := profile("plain-768", plain, map[string]any{"outputDimensions": 768,
		"defaultFusionWeights": map[string]any{"vector": 1, "keyword": 0.02}}, 201, "")
	server := profile("mrl-768", mrl, map[string]any{"outputDimensions": 768, "storageType": "vector"}, 201, "")
	if truncated.Dimensions != 768 || *truncated.OutputDimensions != 768 || truncated.DefaultFusionWeights == nil ||
		truncated.DefaultFusionWeights.Keyword != 0.02 || server.DefaultFusionWeights != nil {
		t.Fatalf("profiles = %+v / %+v", truncated, server)
	}

	base := "/v1/teams/" + env.team
	kbs := map[string]apitypes.KnowledgeBase{}
	for _, p := range []apitypes.EmbeddingProfile{truncated, server} {
		var src apitypes.DataSource
		code, e := owner.call("POST", base+"/sources", map[string]any{"name": p.Key, "classification": "open", "embeddingProfileId": p.Id}, &src, nil)
		mustCode(t, "source "+p.Key, code, e, 201, "")
		docs := base + "/sources/" + src.Id.String() + "/documents"
		owner.uploadFiles(docs, []upload{{"parking.md", []byte(parkingDoc)}, {"housing.md", []byte(housingDoc)}}, "")
		for _, d := range owner.waitForDocuments(t, docs) {
			if d.Status != "ready" {
				t.Fatalf("%s: %s = %s %s", p.Key, d.Filename, d.Status, d.ErrorMessage)
			}
		}
		var kb apitypes.KnowledgeBase
		code, e = owner.call("POST", base+"/kbs", map[string]any{"name": p.Key, "embeddingProfileId": p.Id}, &kb, nil)
		mustCode(t, "kb "+p.Key, code, e, 201, "")
		code, e = owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, &kb, nil)
		mustCode(t, "attach "+p.Key, code, e, 200, "")
		var res apitypes.RetrieveResult
		code, e = owner.call("POST", base+"/kbs/"+kb.Id.String()+"/retrieve", map[string]any{"query": "parking permit decal"}, &res, nil)
		mustCode(t, "retrieve "+p.Key, code, e, 200, "")
		if len(res.Hits) == 0 || res.Hits[0].Filename != "parking.md" {
			t.Fatalf("%s: hits = %+v", p.Key, res.Hits)
		}
		kbs[p.Key] = kb
	}
	// The truncating model was never sent "dimensions"; the other always was.
	var sent, notSent int
	for _, d := range env.proxy.EmbedDimensions() {
		switch d {
		case 768:
			sent++
		case 0:
			notSent++
		default:
			t.Fatalf("dimensions sent = %d", d)
		}
	}
	if sent == 0 || notSent == 0 {
		t.Fatalf("dimensions sent %d, not sent %d", sent, notSent)
	}

	// Fusion weights: KB override → profile default → platform default.
	fusion := func(kb apitypes.KnowledgeBase, keyword float64, source string) {
		t.Helper()
		if kb.EffectiveFusionWeights == nil || kb.EffectiveFusionWeights.Keyword != keyword || kb.FusionWeightsSource == nil ||
			string(*kb.FusionWeightsSource) != source {
			t.Fatalf("%s: weights %+v from %v, want keyword %v from %s", kb.Name, kb.EffectiveFusionWeights, kb.FusionWeightsSource, keyword, source)
		}
	}
	kb := kbs["plain-768"]
	fusion(kb, 0.02, "profile")
	fusion(kbs["mrl-768"], 0.1, "platform")
	code, e := owner.call("PATCH", base+"/kbs/"+kb.Id.String(), map[string]any{"fusionWeights": map[string]any{"vector": 1, "keyword": 0}}, &kb, ifMatch(kb.Revision))
	mustCode(t, "kb override", code, e, 200, "")
	fusion(kb, 0, "knowledge_base")
	code, e = owner.call("PATCH", base+"/kbs/"+kb.Id.String(), map[string]any{"useDefaultFusionWeights": true}, &kb, ifMatch(kb.Revision))
	mustCode(t, "kb default", code, e, 200, "")
	fusion(kb, 0.02, "profile")
	// Profile weights are mutable; the vector settings are not.
	code, e = admin.call("PATCH", "/v1/admin/embedding-profiles/"+truncated.Id.String(),
		map[string]any{"defaultFusionWeights": map[string]any{"vector": 1, "keyword": 0.05}}, &truncated, ifMatch(truncated.Revision))
	mustCode(t, "profile weights", code, e, 200, "")
	owner.get(base+"/kbs/"+kb.Id.String(), &kb)
	fusion(kb, 0.05, "profile")
	code, e = admin.call("PATCH", "/v1/admin/embedding-profiles/"+truncated.Id.String(),
		map[string]any{"usePlatformFusionWeights": true}, &truncated, ifMatch(truncated.Revision))
	mustCode(t, "profile platform weights", code, e, 200, "")
	owner.get(base+"/kbs/"+kb.Id.String(), &kb)
	fusion(kb, 0.1, "platform")
	var res apitypes.RetrieveResult
	code, e = owner.call("POST", base+"/kbs/"+kb.Id.String()+"/retrieve", map[string]any{"query": "move-in residence halls"}, &res, nil)
	mustCode(t, "retrieve after", code, e, 200, "")
	if len(res.Hits) == 0 {
		t.Fatal("no hits after weight changes")
	}
}

// Chat compat: supportsToolChoice and thinkingField round-trip, extraBody is
// validated and reaches the chat and model-test requests (DESIGN.md §10).
func TestChatModelExtraBody(t *testing.T) {
	env := newAgentEnv(t)
	admin := env.admin
	path := "/v1/admin/models/" + env.chat.Id.String()
	patch := func(compat map[string]any, wantCode int, wantErr string) apitypes.Model {
		t.Helper()
		var cur, m apitypes.Model
		admin.get(path, &cur)
		code, e := admin.call("PATCH", path, map[string]any{"compat": compat}, &m, ifMatch(cur.Revision))
		mustCode(t, "patch compat", code, e, wantCode, wantErr)
		return m
	}
	patch(map[string]any{"extraBody": map[string]any{"model": "other"}}, 400, "invalid_extra_body")
	patch(map[string]any{"extraBody": map[string]any{"stream": false}}, 400, "invalid_extra_body")
	patch(map[string]any{"extraBody": map[string]any{"pad": strings.Repeat("x", 5000)}}, 400, "invalid_extra_body")
	var cur apitypes.Model
	admin.get(path, &cur)
	if code, raw := admin.raw("PATCH", path, json.RawMessage(`{"compat":{"extraBody":[1,2]}}`), ifMatch(cur.Revision)); code != 400 {
		t.Fatalf("array extraBody = %d %s", code, raw)
	}
	m := patch(map[string]any{
		"supportsToolChoice": true, "thinkingField": "reasoning_content", "supportsDimensionsParam": true,
		"extraBody": map[string]any{"chat_template_kwargs": map[string]any{"enable_thinking": false}},
	}, 200, "")
	if m.Compat.SupportsToolChoice == nil || !*m.Compat.SupportsToolChoice || m.Compat.ThinkingField == nil ||
		m.Compat.ExtraBody == nil || m.Compat.SupportsDimensionsParam != nil {
		t.Fatalf("compat = %+v", m.Compat)
	}

	before := len(env.proxy.ChatRequests())
	var test apitypes.ModelTestResult
	code, e := admin.call("POST", path+"/test", nil, &test, nil)
	mustCode(t, "model test", code, e, 200, "")
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do I buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	if !strings.Contains(strings.Join(evs.names(), ","), "message_end") {
		t.Fatalf("events = %v", evs.names())
	}
	reqs := env.proxy.ChatRequests()[before:]
	if len(reqs) < 2 {
		t.Fatalf("chat requests = %d", len(reqs))
	}
	for i, raw := range reqs {
		var body struct {
			Model  string `json:"model"`
			Stream bool   `json:"stream"`
			Kwargs struct {
				EnableThinking *bool `json:"enable_thinking"`
			} `json:"chat_template_kwargs"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "chat-tools" || body.Kwargs.EnableThinking == nil || *body.Kwargs.EnableThinking {
			t.Errorf("request %d: %s", i, raw)
		}
	}
}
