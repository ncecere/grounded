package httpapi_test

import (
	"context"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/retention"
)

// The per-level settings of DESIGN.md §4 (migration 00024): allowed source
// types are checked when a source is created, direct /retrieve by API keys
// can be turned off, and conversation retention is stored and validated.
func TestClassificationSettings(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team
	var levels []apitypes.Classification
	env.admin.get("/v1/classifications", &levels)
	open := levels[0]
	if open.Key != "open" || !open.DirectRetrieve || len(open.AllowedSourceTypes) != 2 || open.ConversationRetentionDays != nil {
		t.Fatalf("defaults = %+v", open)
	}

	// Validation.
	for _, bad := range []map[string]any{{"allowedSourceTypes": []string{}}, {"allowedSourceTypes": []string{"sharepoint"}}, {"conversationRetentionDays": 40000}} {
		code, e := env.admin.call("PATCH", "/v1/admin/classifications/open", bad, nil, ifMatch(open.Revision))
		if code != 400 {
			t.Errorf("%v = %d %s", bad, code, e)
		}
	}

	// Open data only in websites, kept 30 days, no direct retrieval.
	var upd apitypes.Classification
	code, e := env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{
		"allowedSourceTypes": []string{"web"}, "conversationRetentionDays": 30, "directRetrieve": false,
	}, &upd, ifMatch(open.Revision))
	mustCode(t, "settings", code, e, 200, "")
	if upd.ConversationRetentionDays == nil || *upd.ConversationRetentionDays != 30 || upd.DirectRetrieve || len(upd.AllowedSourceTypes) != 1 {
		t.Fatalf("updated = %+v", upd)
	}
	code, e = env.owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, nil, nil)
	mustCode(t, "upload source at open", code, e, 400, "source_type_not_allowed")

	// Sensitive keeps the defaults: an upload source, a KB and an API key.
	var src apitypes.DataSource
	code, e = env.owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "sensitive"}, &src, nil)
	mustCode(t, "upload source at sensitive", code, e, 201, "")
	var kb apitypes.KnowledgeBase
	env.owner.call("POST", base+"/kbs", map[string]any{"name": "Handbook"}, &kb, nil)
	code, e = env.owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	var key apitypes.APIKeyCreated
	code, e = env.owner.call("POST", base+"/api-keys", map[string]any{"name": "search", "kind": "service", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	retrieve := base + "/kbs/" + kb.Id.String() + "/retrieve"
	if code, e := keyCall(t, env.app.URL, "POST", retrieve, key.Secret, map[string]any{"query": "hello"}, nil); code != 200 {
		t.Fatalf("key retrieve allowed = %d %s", code, e)
	}
	sensitive := levels[1]
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/sensitive", map[string]any{"directRetrieve": false}, nil, ifMatch(sensitive.Revision))
	mustCode(t, "no direct retrieve", code, e, 200, "")
	if code, e := keyCall(t, env.app.URL, "POST", retrieve, key.Secret, map[string]any{"query": "hello"}, nil); code != 403 || e != "direct_retrieve_not_allowed" {
		t.Fatalf("key retrieve refused = %d %s", code, e)
	}
	// People in the app still can.
	code, e = env.owner.call("POST", retrieve, map[string]any{"query": "hello"}, nil, nil)
	mustCode(t, "session retrieve", code, e, 200, "")

	// The conversation retention rule runs (nothing is old enough yet).
	runner := &retention.Runner{Pool: env.app.Pool, Batch: 10}
	if n, err := runner.Apply(context.Background(), nil); err != nil || n[retention.Conversations].Deleted != 0 {
		t.Fatalf("retention = %v %v", n, err)
	}
	// 0 clears it: kept until deleted.
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"conversationRetentionDays": 0}, &upd, ifMatch(upd.Revision))
	mustCode(t, "clear retention", code, e, 200, "")
	if upd.ConversationRetentionDays != nil {
		t.Errorf("cleared = %v", *upd.ConversationRetentionDays)
	}
}
