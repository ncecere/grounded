package httpapi_test

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestConnectionsStoreKeysEncryptedAndTest(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	auditor := app.signIn("auditor")
	proxy := testutil.NewFakeProxy(t)

	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Bad", "baseUrl": "ftp://x"}, nil, nil)
	mustCode(t, "invalid base URL", code, e, 400, "invalid_base_url")

	code, raw := admin.raw("POST", "/v1/admin/connections", map[string]any{
		"name": "Campus gateway", "baseUrl": proxy.BaseURL() + "/", "apiKey": proxy.APIKey,
	}, nil)
	if code != 201 {
		t.Fatalf("create connection = %d %s", code, raw)
	}
	if bytes.Contains(raw, []byte(proxy.APIKey)) {
		t.Fatal("API key returned in response")
	}
	var conn apitypes.Connection
	admin.call("GET", "/v1/admin/connections", nil, nil, nil)
	var conns []apitypes.Connection
	auditor.get("/v1/admin/connections", &conns)
	if len(conns) != 1 {
		t.Fatalf("connections = %+v", conns)
	}
	conn = conns[0]
	if !conn.HasApiKey || conn.ApiKeyHint != proxy.APIKey[len(proxy.APIKey)-4:] || conn.BaseUrl != proxy.BaseURL() {
		t.Fatalf("connection = %+v", conn)
	}

	// The key is not stored or audited in clear text.
	var stored []byte
	var auditText string
	ctx := context.Background()
	if err := app.Pool.QueryRow(ctx, "SELECT api_key_ciphertext FROM model_connections").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if err := app.Pool.QueryRow(ctx, "SELECT string_agg(coalesce(after_state::text,'') || coalesce(before_state::text,''), '') FROM audit_log").Scan(&auditText); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte(proxy.APIKey)) || strings.Contains(auditText, proxy.APIKey) {
		t.Fatal("API key stored or audited in clear text")
	}

	path := "/v1/admin/connections/" + conn.Id.String()
	var res apitypes.ConnectionTestResult
	code, e = admin.call("POST", path+"/test", nil, &res, nil)
	mustCode(t, "test connection", code, e, 200, "")
	if !res.Ok || !strings.Contains(strings.Join(res.Models, ","), "test-embed") {
		t.Fatalf("test result = %+v", res)
	}
	// Each test opens a new connection and reports its phases (E12).
	for range 2 {
		admin.call("POST", path+"/test", nil, &res, nil)
		if tm := res.Timings; tm == nil || tm.Reused || tm.ConnectMs <= 0 || tm.FirstByteMs <= 0 || tm.TlsMs != 0 {
			t.Fatalf("timings = %+v", tm)
		}
	}
	code, e = auditor.call("POST", path+"/test", nil, nil, nil)
	mustCode(t, "auditor tests connection", code, e, 403, "forbidden")

	// Renaming keeps the key; a wrong key is reported as an auth failure.
	var updated apitypes.Connection
	code, e = admin.call("PATCH", path, map[string]string{"name": "Campus gateway (renamed)"}, &updated, ifMatch(conn.Revision))
	mustCode(t, "rename", code, e, 200, "")
	admin.call("POST", path+"/test", nil, &res, nil)
	if !res.Ok {
		t.Fatalf("key lost on rename: %+v", res.Error)
	}
	code, e = admin.call("PATCH", path, map[string]string{"apiKey": "sk-wrong-key"}, &updated, ifMatch(updated.Revision))
	mustCode(t, "replace key", code, e, 200, "")
	admin.call("POST", path+"/test", nil, &res, nil)
	if res.Ok || res.Error == nil || res.Error.Kind != "auth" {
		t.Fatalf("wrong key result = %+v", res)
	}

	// A different ENCRYPTION_KEY cannot decrypt the stored key.
	other, _ := secrets.New([]byte("another-32-byte-key-for-testing!"))
	_, err := catalog.NewService(app.Pool, other).TestConnection(ctx, authz.Actor{UserID: admin.me.User.Id, PlatformRole: authz.PlatformAdmin}, conn.Id)
	if err == nil || !strings.Contains(err.Error(), "api_key_undecryptable") {
		t.Fatalf("undecryptable key = %v", err)
	}
}

func setupModels(t *testing.T, app *testApp, admin *session) (apitypes.Connection, apitypes.Model, apitypes.Model) {
	t.Helper()
	proxy := testutil.NewFakeProxy(t)
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Proxy", "baseUrl": proxy.BaseURL(), "apiKey": proxy.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")

	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "embed", "upstreamModel": "test-embed", "displayName": "Embed",
		"kind": "embedding", "maxClassification": "restricted",
	}, nil, nil)
	mustCode(t, "embedding without dimensions", code, e, 400, "invalid_dimensions")

	var embed, chat apitypes.Model
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "embed", "upstreamModel": "test-embed", "displayName": "Embed",
		"kind": "embedding", "maxClassification": "restricted", "dimensions": 8, "contextWindow": 999,
	}, &embed, nil)
	mustCode(t, "create embedding model", code, e, 201, "")
	if embed.ContextWindow != nil {
		t.Fatal("chat-only field kept on an embedding model")
	}
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "chat", "upstreamModel": "test-chat", "displayName": "Chat",
		"kind": "chat", "maxClassification": "open", "contextWindow": 8192, "supportsTools": true,
		"compat": map[string]any{"maxTokensField": "max_completion_tokens"},
	}, &chat, nil)
	mustCode(t, "create chat model", code, e, 201, "")
	if chat.Compat.MaxTokensField == nil || *chat.Compat.MaxTokensField != "max_completion_tokens" {
		t.Fatalf("compat not stored: %+v", chat.Compat)
	}
	return conn, embed, chat
}

func TestModelsAndTests(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	_, embed, chat := setupModels(t, app, admin)

	var res apitypes.ModelTestResult
	code, e := admin.call("POST", "/v1/admin/models/"+embed.Id.String()+"/test", nil, &res, nil)
	mustCode(t, "test embedding", code, e, 200, "")
	if !res.Ok || res.Dimensions == nil || *res.Dimensions != 8 || !*res.DimensionsMatch || res.Timings == nil || res.Timings.Reused {
		t.Fatalf("embedding test = %+v", res)
	}
	admin.call("POST", "/v1/admin/models/"+chat.Id.String()+"/test", nil, &res, nil)
	if !res.Ok || res.Reply == nil || *res.Reply != "pong" || res.Usage.TotalTokens == 0 {
		t.Fatalf("chat test = %+v", res)
	}

	// Wrong dimensions are detected by the test.
	var fixed apitypes.Model
	code, e = admin.call("PATCH", "/v1/admin/models/"+embed.Id.String(), map[string]any{"dimensions": 16}, &fixed, ifMatch(embed.Revision))
	mustCode(t, "change dims (unused model)", code, e, 200, "")
	admin.call("POST", "/v1/admin/models/"+embed.Id.String()+"/test", nil, &res, nil)
	if !res.Ok || *res.DimensionsMatch {
		t.Fatalf("mismatch not reported: %+v", res)
	}

	var byKind []apitypes.Model
	admin.get("/v1/admin/models?kind=chat", &byKind)
	if len(byKind) != 1 || byKind[0].Key != "chat" {
		t.Fatalf("kind filter = %+v", byKind)
	}
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": chat.ConnectionId, "key": "chat", "upstreamModel": "other", "displayName": "Dup",
		"kind": "chat", "maxClassification": "open",
	}, nil, nil)
	mustCode(t, "duplicate key", code, e, 409, "key_taken")
}

func TestEmbeddingProfiles(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	conn, embed, chat := setupModels(t, app, admin)

	code, e := admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{"key": "p", "name": "P", "modelId": chat.Id}, nil, nil)
	mustCode(t, "profile on chat model", code, e, 400, "not_embedding_model")
	code, e = admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{"key": "p", "name": "P", "modelId": embed.Id, "chunkSize": 100, "chunkOverlap": 100}, nil, nil)
	mustCode(t, "overlap >= size", code, e, 400, "invalid_chunk_overlap")

	var first, second apitypes.EmbeddingProfile
	code, e = admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{
		"key": "embed-8", "name": "Embed 8", "modelId": embed.Id,
		"documentPrefix": "search_document: ", "queryPrefix": "search_query: ",
	}, &first, nil)
	mustCode(t, "create first profile", code, e, 201, "")
	if !first.IsDefault || first.Dimensions != 8 || first.StorageType != "halfvec" || first.ChunkSize != 512 || first.Model.MaxClassification != "restricted" {
		t.Fatalf("first profile = %+v", first)
	}
	code, e = admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{"key": "embed-8b", "name": "Embed 8 B", "modelId": embed.Id, "chunkSize": 256}, &second, nil)
	mustCode(t, "create second profile", code, e, 201, "")
	if second.IsDefault {
		t.Fatal("second profile became default")
	}

	// Moving the default; the old default can't be unset directly or retired.
	fp := "/v1/admin/embedding-profiles/" + first.Id.String()
	code, e = admin.call("PATCH", fp, map[string]any{"isDefault": false}, nil, ifMatch(first.Revision))
	mustCode(t, "unset default", code, e, 409, "default_required")
	code, e = admin.call("PATCH", fp, map[string]any{"status": "retired"}, nil, ifMatch(first.Revision))
	mustCode(t, "retire default", code, e, 409, "default_must_be_active")
	var sec2 apitypes.EmbeddingProfile
	code, e = admin.call("PATCH", "/v1/admin/embedding-profiles/"+second.Id.String(), map[string]any{"isDefault": true}, &sec2, ifMatch(second.Revision))
	mustCode(t, "make second default", code, e, 200, "")
	var list []apitypes.EmbeddingProfile
	admin.get("/v1/admin/embedding-profiles", &list)
	defaults := 0
	for _, p := range list {
		if p.IsDefault {
			defaults++
			if p.Id != second.Id {
				t.Fatalf("wrong default: %s", p.Key)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("%d defaults", defaults)
	}

	// An embedding model used by a profile is protected.
	var cur apitypes.Model
	admin.get("/v1/admin/models/"+embed.Id.String(), &cur)
	code, e = admin.call("PATCH", "/v1/admin/models/"+embed.Id.String(), map[string]any{"dimensions": 16}, nil, ifMatch(cur.Revision))
	mustCode(t, "change dims of used model", code, e, 409, "model_in_use")
	code, e = admin.call("PATCH", "/v1/admin/models/"+embed.Id.String(), map[string]any{"displayName": "Embed v2"}, nil, ifMatch(cur.Revision))
	mustCode(t, "rename used model", code, e, 200, "")
	code, e = admin.call("DELETE", "/v1/admin/models/"+embed.Id.String(), nil, nil, nil)
	mustCode(t, "delete used model", code, e, 409, "model_in_use")
	code, e = admin.call("DELETE", "/v1/admin/connections/"+conn.Id.String(), nil, nil, nil)
	mustCode(t, "delete used connection", code, e, 409, "connection_in_use")

	// Unused, non-default profiles can be deleted.
	code, e = admin.call("DELETE", fp, nil, nil, nil)
	mustCode(t, "delete old default", code, e, 200, "")

	auditor := app.signIn("auditor")
	if code := auditor.get("/v1/admin/embedding-profiles", &list); code != 200 {
		t.Fatalf("auditor list = %d", code)
	}
	code, e = auditor.call("POST", "/v1/admin/embedding-profiles", map[string]any{"key": "x", "name": "X", "modelId": embed.Id}, nil, nil)
	mustCode(t, "auditor creates profile", code, e, 403, "forbidden")
}
