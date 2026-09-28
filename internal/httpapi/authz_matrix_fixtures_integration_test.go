package httpapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/testutil"
)

// Fixtures for the authorization matrix (authz_matrix_integration_test.go):
// team B ("registrar", the callers' own team) and team A ("foreign", whose
// objects no caller from team B may reach), each with a representative
// object of every kind, plus platform objects for the admin routes.

// Markers of team A. Its object names all contain nameMarker; its document
// and conversation text contain contentMarker. Neither may reach a caller
// who is not allowed to see team A (names are metadata that platform admins
// and auditors may read; content only under break-glass).
const (
	nameMarker    = "Xyzzy"
	contentMarker = "quokka-lantern"
	widgetOrigin  = "https://widget.example"
)

// teamFix is one team's fixtures: IDs as strings, ready for paths.
type teamFix struct {
	slug, id, name string
	owner          *session
	source, doc    string // an upload source and one of its documents
	web, webDoc    string // a web source and one of its pages
	crawl          string // the web source's first crawl
	kb             string
	agent, agentSl string // the team's main agent and its slug
	serviceKey     string // a team service key (ID)
	pubKey         string // a publishable key of the main agent (ID)
	pubSecret      string
	invite         string // a pending invite
	memberID       string // a plain member (not the owner)
	auditID        string
	domainRequest  string
	conv, message  string // the owner's conversation and its answer
	// ids are every object ID of the team, for the leak check.
	ids []string
}

// matrixEnv is the platform the matrix runs against.
type matrixEnv struct {
	*publishEnv
	oidc   *testutil.OIDCProvider
	a, b   *teamFix
	actors [numCallers]*actor
	// own holds each caller's own objects (conversation, message,
	// notification), created on first use.
	own [numCallers]*ownObjects
	// Platform fixtures.
	sharedSource, sharedDoc, allowlist, profile, legalHold, breakGlass, retentionRun string
	sharedWeb, sharedCrawl, sharedWebDoc                                             string
	migration, migrationKB, targetProfile                                            string
	// groupRule is an SSO group mapping rule on team B.
	groupRule      string
	publicSessions [numCallers]bool
	seq            atomic.Int64
}

type ownObjects struct{ conv, message, notification string }

// ---- plumbing ------------------------------------------------------------------

// must performs a JSON call that has to succeed and returns its data.
func must(t *testing.T, s *session, method, path string, body any, headers map[string]string) any {
	t.Helper()
	code, raw := s.raw(method, path, body, headers)
	if code < 200 || code > 299 {
		t.Fatalf("%s %s = %d %s", method, path, code, raw)
	}
	var env struct{ Data any }
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("decode %s %s: %v", method, path, err)
	}
	return env.Data
}

// field reads a nested field of decoded JSON ("key.id", "items.0.id").
func field(v any, path string) string {
	for _, k := range strings.Split(path, ".") {
		switch m := v.(type) {
		case map[string]any:
			v = m[k]
		case []any:
			var i int
			if _, err := fmt.Sscanf(k, "%d", &i); err != nil || i >= len(m) {
				return ""
			}
			v = m[i]
		default:
			return ""
		}
	}
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return fmt.Sprintf("%.0f", x)
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func (e *matrixEnv) next() int64 { return e.seq.Add(1) }

// oidcSignIn signs in a new person through the test OIDC provider (the dev
// personas are all taken by team B and the platform roles).
func (e *matrixEnv) oidcSignIn(t *testing.T, name string) *session {
	t.Helper()
	e.oidc.SetClaims(map[string]any{"sub": name, "email": name + "@example.edu", "email_verified": true, "name": name})
	jar, _ := cookiejar.New(nil)
	s := &session{t: t, app: e.app, client: &http.Client{Jar: jar}}
	res, err := s.client.Get(e.app.URL + "/auth/login")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	s.refresh()
	return s
}

// upload posts one file to a documents path and returns the document ID.
func uploadOne(t *testing.T, s *session, path, name, text string) string {
	t.Helper()
	code, res, e := s.uploadFiles(path, []upload{{name, []byte(text)}}, "")
	if code != 200 || len(res) != 1 || res[0].Document == nil {
		t.Fatalf("upload %s to %s = %d %s %+v", name, path, code, e, res)
	}
	return res[0].Document.Id.String()
}

// ---- building the platform -------------------------------------------------------

func newMatrixEnv(t *testing.T) *matrixEnv {
	t.Helper()
	p := testutil.NewOIDCProvider(t)
	agent := newAgentEnvWith(t, func(c *config.Config) {
		c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = p.URL, p.ClientID, p.ClientSecret
		c.LoginAttemptsPerMinute = 100_000 // the matrix signs many people in
	})
	mod := &moderationEnv{agentEnv: agent}
	code, e := agent.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": agent.conn.Id, "key": "mod-classifier", "upstreamModel": "chat-tools", "displayName": "Classifier",
		"kind": "moderation", "maxClassification": "sensitive", "moderationProvider": "chat_classifier",
	}, &mod.classifier, nil)
	mustCode(t, "classifier model", code, e, 201, "")
	e2 := &matrixEnv{publishEnv: &publishEnv{moderationEnv: mod}, oidc: p}
	e2.b = e2.seedTeamB(t)
	e2.a = e2.seedTeamA(t)
	e2.seedPlatform(t)
	e2.makeActors(t)
	return e2
}

// seedTeamB completes the agent environment's team ("registrar", owned by
// user@localhost with an editor, a member and a team admin): a public
// agent with a publishable key, a web source, and the rest.
func (e *matrixEnv) seedTeamB(t *testing.T) *teamFix {
	t.Helper()
	f := &teamFix{slug: e.team, owner: e.owner, source: e.upload.Id.String(), kb: e.kb.Id.String()}
	ag := e.publicAgent(t, "B helper")
	f.agent, f.agentSl = ag.Id.String(), ag.Slug
	e.seedCommon(t, f, "B")
	f.memberID = e.freshMember(t, f) // a member none of the callers is
	return f
}

// seedTeamA creates team A with an owner who signs in through OIDC, and
// every object with the markers.
func (e *matrixEnv) seedTeamA(t *testing.T) *teamFix {
	t.Helper()
	owner := e.oidcSignIn(t, "aowner")
	data := must(t, e.admin, "POST", "/v1/admin/teams", map[string]any{
		"slug": "foreign", "name": nameMarker + " Team", "maxClassification": "sensitive", "ownerEmail": "aowner@example.edu",
	}, nil)
	owner.refresh()
	f := &teamFix{slug: "foreign", id: field(data, "team.id"), owner: owner}
	base := "/v1/teams/" + f.slug
	f.source = field(must(t, owner, "POST", base+"/sources", map[string]any{"name": nameMarker + " handbook", "classification": "open"}, nil), "id")
	uploadOne(t, owner, base+"/sources/"+f.source+"/documents", "xyzzy.md",
		"# "+nameMarker+" facts\n\nThe "+contentMarker+" opens the north gate at dawn.\n")
	owner.waitForDocuments(t, base+"/sources/"+f.source+"/documents")
	f.kb = field(must(t, owner, "POST", base+"/kbs", map[string]any{"name": nameMarker + " KB"}, nil), "id")
	must(t, owner, "PUT", base+"/kbs/"+f.kb+"/sources/"+f.source, nil, nil)
	ag := must(t, owner, "POST", base+"/agents", map[string]any{"name": nameMarker + " agent", "config": e.agentConfig(f.kb)}, nil)
	f.agent, f.agentSl = field(ag, "id"), field(ag, "slug")
	must(t, owner, "POST", base+"/agents/"+f.agent+"/publish", map[string]any{"note": "first"}, nil)
	e.seedCommon(t, f, nameMarker)
	member := e.oidcSignIn(t, "amember")
	must(t, owner, "POST", base+"/members", map[string]any{"email": "amember@example.edu", "role": "member"}, nil)
	f.memberID = member.me.User.Id.String()
	f.ids = append(f.ids, f.id, f.memberID, owner.me.User.Id.String())
	return f
}

// seedCommon adds what both teams have: a document, a web source with a
// crawl, a service key, a publishable key, an invite, a domain request, the
// owner's conversation, and the first audit entry.
func (e *matrixEnv) seedCommon(t *testing.T, f *teamFix, prefix string) {
	t.Helper()
	s, base := f.owner, "/v1/teams/"+f.slug
	docs := base + "/sources/" + f.source + "/documents"
	f.doc = field(must(t, s, "GET", docs, nil, nil), "items.0.id")
	web := must(t, s, "POST", base+"/sources", map[string]any{"name": prefix + " web", "type": "web", "classification": "open",
		"web": map[string]any{"mode": "batch", "urls": []string{e.site.url("/")}}}, nil)
	f.web, f.crawl = field(web, "id"), field(web, "activeCrawl.id")
	waitCrawl(t, s, base+"/sources/"+f.web, stringer(f.crawl))
	f.webDoc = s.waitForDocuments(t, base+"/sources/"+f.web+"/documents")[0].Id.String()
	f.serviceKey = field(must(t, s, "POST", base+"/api-keys", map[string]any{"name": prefix + " service", "kind": "service",
		"scopes": []string{"query", "ingest", "manage"}}, nil), "key.id")
	pk := must(t, s, "POST", base+"/agents/"+f.agent+"/publishable-keys", map[string]any{"name": prefix + " widget",
		"allowedOrigins": []string{widgetOrigin}}, nil)
	f.pubKey, f.pubSecret = field(pk, "id"), field(pk, "key")
	f.invite = field(must(t, s, "POST", base+"/members", map[string]any{"email": strings.ToLower(prefix) + "-invitee@example.org", "role": "member"}, nil), "invite.id")
	f.domainRequest = field(must(t, s, "POST", base+"/domain-requests", map[string]any{"pattern": strings.ToLower(prefix) + "-docs.example.org",
		"reason": prefix + " documentation site"}, nil), "id")
	topic := "parking permits"
	if prefix == nameMarker {
		topic = "the " + contentMarker // team A's transcripts carry the content marker
	}
	ans := must(t, s, "POST", "/v1/agents/"+f.slug+"/"+f.agentSl+"/chat", map[string]any{"message": "What about " + topic + "?", "stream": false}, nil)
	f.conv, f.message = field(ans, "conversationId"), field(ans, "messageId")
	must(t, s, "PATCH", "/v1/conversations/"+f.conv, map[string]any{"title": prefix + " chat about " + topic}, nil)
	f.auditID = field(must(t, s, "GET", base+"/audit", nil, nil), "items.0.id")
	team := must(t, s, "GET", base, nil, nil)
	f.id, f.name = field(team, "id"), field(team, "name")
	f.ids = append(f.ids, f.id, f.source, f.doc, f.web, f.webDoc, f.crawl, f.kb, f.agent, f.serviceKey, f.pubKey, f.invite,
		f.domainRequest, f.conv, f.message)
}

type stringer string

func (s stringer) String() string { return string(s) }

// seedPlatform creates the platform objects the admin routes act on.
func (e *matrixEnv) seedPlatform(t *testing.T) {
	t.Helper()
	a := e.admin
	e.sharedSource = field(must(t, a, "POST", "/v1/admin/shared-sources", map[string]any{"name": "Platform glossary", "classification": "open"}, nil), "id")
	e.sharedDoc = uploadOne(t, a, "/v1/admin/shared-sources/"+e.sharedSource+"/documents", "glossary.md", "# Glossary\n\nA shared page.\n")
	web := must(t, a, "POST", "/v1/admin/shared-sources", map[string]any{"name": "Platform site", "type": "web", "classification": "open",
		"web": map[string]any{"mode": "batch", "urls": []string{e.site.url("/")}}}, nil)
	e.sharedWeb, e.sharedCrawl = field(web, "id"), field(web, "activeCrawl.id")
	waitCrawl(t, a, "/v1/admin/shared-sources/"+e.sharedWeb, stringer(e.sharedCrawl))
	e.sharedWebDoc = a.waitForDocuments(t, "/v1/admin/shared-sources/"+e.sharedWeb+"/documents")[0].Id.String()
	e.allowlist = field(must(t, a, "POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "docs.example.net"}, nil), "id")
	e.profile = field(must(t, a, "GET", "/v1/admin/embedding-profiles", nil, nil), "0.id")
	e.legalHold = field(must(t, a, "POST", "/v1/admin/legal-holds", map[string]any{"scopeType": "team", "scope": e.b.slug,
		"reason": "Matrix fixture"}, nil), "id")
	bg := startBreakGlass(t, a, e.b.slug, "documents")
	e.breakGlass = bg.Id.String()
	must(t, a, "POST", "/v1/admin/break-glass/"+e.breakGlass+"/end", nil, nil)
	e.retentionRun = field(must(t, a, "POST", "/v1/admin/retention/runs", map[string]any{}, nil), "id")
	// A second embedding profile, and a migration of a team B knowledge base to it.
	e.proxy.AddEmbeddingModel("bow-48", 48)
	model := must(t, a, "POST", "/v1/admin/models", map[string]any{"connectionId": e.conn.Id, "key": "bow48", "upstreamModel": "bow-48",
		"displayName": "BoW 48", "kind": "embedding", "maxClassification": "restricted", "dimensions": 48}, nil)
	e.targetProfile = field(must(t, a, "POST", "/v1/admin/embedding-profiles", map[string]any{"key": "twin-48", "name": "Twin 48",
		"modelId": field(model, "id"), "chunkSize": 128, "chunkOverlap": 16}, nil), "id")
	e.migrationKB = e.freshKB(t, e.b)
	must(t, e.owner, "PUT", "/v1/teams/"+e.b.slug+"/kbs/"+e.migrationKB+"/sources/"+e.b.source, nil, nil)
	e.migration = field(must(t, a, "POST", "/v1/admin/profile-migrations", map[string]any{"kbId": e.migrationKB, "targetProfileId": e.targetProfile}, nil), "id")
	// Short names: team B's public agent; team A's team-only agent, if the
	// platform allows one (the matrix asks for it by name either way).
	a.raw("PUT", "/v1/admin/agents/"+e.a.agent+"/short-name", map[string]any{"shortName": "xyzzy"}, nil)
	// A short name for team B's public agent.
	must(t, a, "PUT", "/v1/admin/agents/"+e.b.agent+"/short-name", map[string]any{"shortName": "bhelp"}, nil)
	e.groupRule = e.freshGroupRule(t)
}

// ---- fresh objects -----------------------------------------------------------------
//
// Calls expected to succeed get a fresh object when they would destroy or
// change the fixture; denied calls get the fixture itself, and the test
// checks at the end that team A's fixtures are all still there.

func (e *matrixEnv) freshSource(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/sources", map[string]any{"name": fmt.Sprintf("fresh source %d", e.next()),
		"classification": "open"}, nil), "id")
}

func (e *matrixEnv) freshDoc(t *testing.T, f *teamFix) string {
	return uploadOne(t, f.owner, "/v1/teams/"+f.slug+"/sources/"+f.source+"/documents", fmt.Sprintf("fresh-%d.md", e.next()), "# Fresh\n\nA page.\n")
}

func (e *matrixEnv) freshKB(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/kbs", map[string]any{"name": fmt.Sprintf("fresh kb %d", e.next())}, nil), "id")
}

func (e *matrixEnv) freshAgent(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/agents", map[string]any{"name": fmt.Sprintf("fresh agent %d", e.next()),
		"config": e.agentConfig(f.kb)}, nil), "id")
}

func (e *matrixEnv) freshServiceKey(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/api-keys", map[string]any{"name": fmt.Sprintf("fresh %d", e.next()),
		"kind": "service", "scopes": []string{"query"}}, nil), "key.id")
}

func (e *matrixEnv) freshPubKey(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/agents/"+f.agent+"/publishable-keys",
		map[string]any{"name": fmt.Sprintf("fresh %d", e.next())}, nil), "id")
}

func (e *matrixEnv) freshInvite(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/members", map[string]any{"email": fmt.Sprintf("invitee-%d@example.org", e.next()),
		"role": "member"}, nil), "invite.id")
}

func (e *matrixEnv) freshMember(t *testing.T, f *teamFix) string {
	s := e.oidcSignIn(t, fmt.Sprintf("person%d", e.next()))
	must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/members", map[string]any{"email": s.me.User.Email, "role": "member"}, nil)
	return s.me.User.Id.String()
}

func (e *matrixEnv) freshUser(t *testing.T) *session {
	return e.oidcSignIn(t, fmt.Sprintf("person%d", e.next()))
}

func (e *matrixEnv) freshDomainRequest(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/domain-requests", map[string]any{
		"pattern": fmt.Sprintf("site%d.example.org", e.next()), "reason": "Fresh request"}, nil), "id")
}

func (e *matrixEnv) freshSharedSource(t *testing.T) string {
	return field(must(t, e.admin, "POST", "/v1/admin/shared-sources", map[string]any{"name": fmt.Sprintf("shared %d", e.next()),
		"classification": "open"}, nil), "id")
}

func (e *matrixEnv) freshSharedDoc(t *testing.T) string {
	return uploadOne(t, e.admin, "/v1/admin/shared-sources/"+e.sharedSource+"/documents", fmt.Sprintf("shared-%d.md", e.next()), "# Shared\n\nA page.\n")
}

func (e *matrixEnv) freshConnection(t *testing.T) string {
	return field(must(t, e.admin, "POST", "/v1/admin/connections", map[string]any{"name": fmt.Sprintf("conn %d", e.next()),
		"baseUrl": e.proxy.BaseURL(), "apiKey": e.proxy.APIKey}, nil), "id")
}

func (e *matrixEnv) freshModel(t *testing.T) string {
	n := e.next()
	return field(must(t, e.admin, "POST", "/v1/admin/models", map[string]any{"connectionId": e.conn.Id, "key": fmt.Sprintf("chat-%d", n),
		"upstreamModel": fmt.Sprintf("upstream-%d", n), "displayName": fmt.Sprintf("Chat %d", n), "kind": "chat", "maxClassification": "open"}, nil), "id")
}

func (e *matrixEnv) freshProfile(t *testing.T) string {
	model := field(must(t, e.admin, "GET", "/v1/admin/embedding-profiles/"+e.profile, nil, nil), "model.id")
	n := e.next()
	return field(must(t, e.admin, "POST", "/v1/admin/embedding-profiles", map[string]any{"key": fmt.Sprintf("p-%d", n),
		"name": fmt.Sprintf("Profile %d", n), "modelId": model}, nil), "id")
}

// freshMigrationKB is a team B knowledge base over the upload source,
// ready to migrate.
func (e *matrixEnv) freshMigrationKB(t *testing.T) string {
	kb := e.freshKB(t, e.b)
	must(t, e.owner, "PUT", "/v1/teams/"+e.b.slug+"/kbs/"+kb+"/sources/"+e.b.source, nil, nil)
	return kb
}

func (e *matrixEnv) freshAllowlist(t *testing.T) string {
	return field(must(t, e.admin, "POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": fmt.Sprintf("h%d.example.net", e.next())}, nil), "id")
}

func (e *matrixEnv) freshLegalHold(t *testing.T) string {
	return field(must(t, e.admin, "POST", "/v1/admin/legal-holds", map[string]any{"scopeType": "team", "scope": e.b.slug,
		"reason": fmt.Sprintf("Hold %d", e.next())}, nil), "id")
}

// freshGroupRule maps a new group (nobody has it) to team B.
func (e *matrixEnv) freshGroupRule(t *testing.T) string {
	return field(must(t, e.admin, "POST", "/v1/admin/group-mapping/rules", map[string]any{"group": fmt.Sprintf("matrix-group-%d", e.next()),
		"team": e.b.slug, "role": "member"}, nil), "id")
}

// freshBreakGlass starts a session on team B (documents) for the admin.
func (e *matrixEnv) freshBreakGlass(t *testing.T) string {
	e.endOpenBreakGlass(t)
	return startBreakGlass(t, e.admin, e.b.slug, "documents").Id.String()
}

// endOpenBreakGlass ends the admin's open sessions (one per admin and team).
func (e *matrixEnv) endOpenBreakGlass(t *testing.T) {
	for _, s := range must(t, e.admin, "GET", "/v1/me/break-glass", nil, nil).([]any) {
		if id := field(s, "id"); id != "" {
			e.admin.raw("POST", "/v1/admin/break-glass/"+id+"/end", nil, nil)
		}
	}
}

// ensurePublicSession starts the caller's anonymous session for team B's
// public agent (once; the cookie stays in the caller's jar).
func (e *matrixEnv) ensurePublicSession(t *testing.T, c caller) {
	t.Helper()
	if e.publicSessions[c] {
		return
	}
	key, origin := (&mctx{e: e, who: c}).publicKey()
	code, raw := e.send(t, c, post("/v1/public/sessions", map[string]any{"agentId": e.b.agent, "key": key, "embedOrigin": origin}).anon())
	if code != 201 {
		t.Fatalf("public session as %s = %d %s", c, code, raw)
	}
	e.publicSessions[c] = true
}

// notification is the team owner's latest notification ("" if none).
func (f *teamFix) notification(t *testing.T) string {
	return field(must(t, f.owner, "GET", "/v1/notifications", nil, nil), "items.0.id")
}

// listRev reads an item's revision from a list as s.
func listRev(t *testing.T, s *session, path, id string) int64 {
	t.Helper()
	for _, it := range must(t, s, "GET", path, nil, nil).([]any) {
		if field(it, "id") == id || field(it, "key") == id || field(it, "user.id") == id {
			var n int64
			fmt.Sscan(field(it, "revision"), &n)
			return n
		}
	}
	t.Fatalf("%s has no %s", path, id)
	return 0
}

func (c *mctx) memberRev(id string) map[string]string {
	return ifMatch(listRev(c.t, c.tf.owner, c.team("/members"), id))
}

func (c *mctx) pubKeyRev() int64 {
	return listRev(c.t, c.tf.owner, c.ag("/publishable-keys"), c.tf.pubKey)
}

func (c *mctx) classificationRev(key string) int64 {
	return listRev(c.t, c.e.admin, "/v1/classifications", key)
}

// ---- multipart ---------------------------------------------------------------------

func multipartBody(files []upload) (string, []byte) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, f := range files {
		w, _ := mw.CreateFormFile("files", f.name)
		_, _ = w.Write(f.data)
	}
	_ = mw.Close()
	return mw.FormDataContentType(), body.Bytes()
}

func readAll(r io.Reader) []byte { b, _ := io.ReadAll(r); return b }
