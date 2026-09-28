package httpapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The authorization matrix (docs/phase5-deploy.md §5, "Test coverage";
// docs/security/controls.md). Every operation in api/openapi.yaml is
// classified in matrixPolicies (authz_matrix_policy_*_test.go): who may
// call it on their own team or objects, and who may call it on another
// team's. The test calls every operation as every kind of caller:
//
//   - against the caller's own team (B) or own objects: success exactly for
//     the classified callers;
//   - against team A's objects: denied (401, 403 or 404) for everyone but
//     the classified platform readers, and never with team A's data in the
//     response. Team A's names and IDs reach no one from team B; its content
//     (document text, transcripts) reaches no one at all.
//
// An operation missing from the table fails TestAuthzMatrixClassifiesEveryOperation
// (no database needed), so every new route has to be classified.

// caller is a kind of credential.
type caller int

const (
	cAnon caller = iota
	cMember
	cEditor
	cTeamAdmin
	cOwner
	cPlatformAdmin
	cAuditor
	cKeyQuery   // personal API key, scope query
	cKeyIngest  // personal API key, scope ingest
	cKeyManage  // personal API key, scope manage
	cServiceKey // team service key, every scope
	cPublishable
	numCallers
)

var callerNames = [numCallers]string{"anonymous", "member", "editor", "team-admin", "owner", "platform-admin", "auditor",
	"key-query", "key-ingest", "key-manage", "service-key", "publishable-key"}

func (c caller) String() string { return callerNames[c] }

// callers is a set of callers.
type callers uint32

func of(cs ...caller) callers {
	var s callers
	for _, c := range cs {
		s |= 1 << c
	}
	return s
}

func (s callers) has(c caller) bool { return s&(1<<c) != 0 }
func (s callers) and(o ...callers) callers {
	for _, x := range o {
		s |= x
	}
	return s
}

// Caller sets used by the tables. An operation without `own` or `foreign`
// is closed to everyone in that context.
var (
	members   = of(cMember, cEditor, cTeamAdmin, cOwner)
	editors   = of(cEditor, cTeamAdmin, cOwner)
	admins    = of(cTeamAdmin, cOwner)
	platform  = of(cPlatformAdmin, cAuditor)
	padmin    = of(cPlatformAdmin)
	signedIn  = members.and(platform)
	persKeys  = of(cKeyQuery, cKeyIngest, cKeyManage)
	allKeys   = persKeys.and(of(cServiceKey))
	everyone  = callers(1<<numCallers - 1)
	noBearers = of(cAnon, cPublishable).and(signedIn)
)

// scope says how an operation is exercised.
type scope int

const (
	// scopeGlobal: no team or per-user object in the request (open and
	// platform routes); each caller calls it once.
	scopeGlobal scope = iota
	// scopeTeam: the path names a team; team B's callers call it on team
	// B, and every caller on team A.
	scopeTeam
	// scopeUser: a per-user object (conversation, message, notification);
	// each caller calls it on its own object and on team A's owner's.
	scopeUser
	// scopePublic: the anonymous API; team B's public agent, and team A's
	// team-only agent.
	scopePublic
)

// policy is one operation's classification.
type policy struct {
	scope scope
	// own: callers allowed on their own team or objects (or at all, for
	// scopeGlobal).
	own callers
	// foreign: callers allowed on team A (platform metadata reads).
	foreign callers
	// also lists other results that count as allowed ("409" or
	// "409 not_running"): the call passed authorization and was refused
	// for the state of the object.
	also []string
	// anyStatus: the status is not checked (sign-in plumbing), only leaks.
	anyStatus bool
	build     func(c *mctx) request
}

// request is one call.
type request struct {
	method, path string
	body         any
	files        []upload
	headers      map[string]string
	// public: the anonymous API. A publishable key travels in the body or
	// query, as the widget sends it, not as a bearer token.
	public bool
	// newSession: sign the caller in again first (logout would end the
	// shared session).
	newSession bool
	skip       string
}

func get(p string) request                       { return request{method: "GET", path: p} }
func post(p string, body any) request            { return request{method: "POST", path: p, body: body} }
func put(p string, body any) request             { return request{method: "PUT", path: p, body: body} }
func patch(p string, body any) request           { return request{method: "PATCH", path: p, body: body} }
func del(p string) request                       { return request{method: "DELETE", path: p} }
func (r request) h(hs map[string]string) request { r.headers = hs; return r }
func (r request) anon() request                  { r.public = true; return r }

// mctx is what a request builder sees.
type mctx struct {
	e       *matrixEnv
	t       *testing.T
	who     caller
	tf      *teamFix // the target team
	foreign bool
	allowed bool // expected to succeed: destructive calls get fresh objects
}

func (c *mctx) team(suffix string) string { return "/v1/teams/" + c.tf.slug + suffix }
func (c *mctx) src(suffix string) string  { return c.team("/sources/" + c.tf.source + suffix) }
func (c *mctx) web(suffix string) string  { return c.team("/sources/" + c.tf.web + suffix) }
func (c *mctx) kb(suffix string) string   { return c.team("/kbs/" + c.tf.kb + suffix) }
func (c *mctx) ag(suffix string) string   { return c.team("/agents/" + c.tf.agent + suffix) }

// pick returns a fresh object when the call is expected to succeed, else
// the fixture.
func (c *mctx) pick(fixture string, fresh func(*testing.T, *teamFix) string) string {
	if c.allowed {
		return fresh(c.t, c.tf)
	}
	return fixture
}

// pickP is pick for platform objects.
func (c *mctx) pickP(fixture string, fresh func(*testing.T) string) string {
	if c.allowed {
		return fresh(c.t)
	}
	return fixture
}

// own returns the caller's own objects, or team A's owner's.
func (c *mctx) own() *ownObjects {
	if c.foreign {
		return &ownObjects{conv: c.tf.conv, message: c.tf.message}
	}
	return c.e.ownFor(c.t, c.who)
}

// rev is an If-Match header with the resource's current revision, read as
// the platform admin (/v1/admin) or the target team's owner.
func (c *mctx) rev(path string) map[string]string {
	s := c.tf.owner
	if strings.HasPrefix(path, "/v1/admin/") {
		s = c.e.admin
	}
	return ifMatch(revisionOf(c.t, s, path))
}

// current reads a resource as the platform admin.
func (c *mctx) current(path string) map[string]any {
	d, _ := must(c.t, c.e.admin, "GET", path, nil, nil).(map[string]any)
	return d
}

func revisionOf(t *testing.T, s *session, path string) int64 {
	t.Helper()
	d := must(t, s, "GET", path, nil, nil)
	raw := field(d, "revision")
	for _, alt := range []string{"team.revision", "user.revision"} { // the admin team and user views
		if raw == "" {
			raw = field(d, alt)
		}
	}
	rev, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		t.Fatalf("no revision in GET %s: %v", path, d)
	}
	return rev
}

// ---- callers -----------------------------------------------------------------------

// actor is a caller's credential.
type actor struct {
	client *http.Client
	csrf   string
	bearer string
	// account is the dev persona, for newSession.
	account string
}

func noFollow(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

func (e *matrixEnv) makeActors(t *testing.T) {
	t.Helper()
	jarClient := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		return &http.Client{Jar: jar, CheckRedirect: noFollow}
	}
	sess := func(s *session, account string) *actor {
		return &actor{client: &http.Client{Jar: s.client.Jar, CheckRedirect: noFollow}, csrf: s.csrf, account: account}
	}
	e.actors[cAnon] = &actor{client: jarClient()}
	e.actors[cMember] = sess(e.member, "blair")
	e.actors[cEditor] = sess(e.editor, "alex")
	e.actors[cTeamAdmin] = sess(e.tadmin, "casey")
	e.actors[cOwner] = sess(e.owner, "user")
	e.actors[cPlatformAdmin] = sess(e.admin, "admin")
	e.actors[cAuditor] = sess(e.auditor, "auditor")
	key := func(kind string, scopes ...string) *actor {
		d := must(t, e.owner, "POST", e.base+"/api-keys", map[string]any{"name": kind + " " + strings.Join(scopes, "+"), "kind": kind, "scopes": scopes}, nil)
		return &actor{client: &http.Client{CheckRedirect: noFollow}, bearer: field(d, "secret")}
	}
	e.actors[cKeyQuery] = key("personal", "query")
	e.actors[cKeyIngest] = key("personal", "ingest")
	e.actors[cKeyManage] = key("personal", "manage")
	e.actors[cServiceKey] = key("service", "query", "ingest", "manage")
	e.actors[cPublishable] = &actor{client: jarClient(), bearer: e.b.pubSecret}
}

// send performs r as caller c.
func (e *matrixEnv) send(t *testing.T, c caller, r request) (int, []byte) {
	t.Helper()
	act := e.actors[c]
	if r.newSession && act.account != "" {
		fresh := e.app.signIn(act.account)
		act = &actor{client: &http.Client{Jar: fresh.client.Jar, CheckRedirect: noFollow}, csrf: fresh.csrf}
	}
	var body io.Reader
	contentType := ""
	switch {
	case r.files != nil:
		ct, b := multipartBody(r.files)
		contentType, body = ct, bytes.NewReader(b)
	case r.body != nil:
		b, _ := json.Marshal(r.body)
		contentType, body = "application/json", bytes.NewReader(b)
	}
	req, err := http.NewRequest(r.method, e.app.URL+r.path, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if r.method != http.MethodGet {
		req.Header.Set("Origin", e.app.URL)
		if act.csrf != "" {
			req.Header.Set("X-CSRF-Token", act.csrf)
		}
	}
	if act.bearer != "" && !(r.public && c == cPublishable) {
		req.Header.Set("Authorization", "Bearer "+act.bearer)
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	res, err := act.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", r.method, r.path, err)
	}
	defer res.Body.Close()
	return res.StatusCode, readAll(res.Body)
}

// ownFor returns (creating on first use) the caller's own conversation,
// answer and notification. Callers who keep no conversations (anonymous,
// service and publishable keys) get team B's owner's, which they must not
// reach. Personal keys without the query scope can't chat: theirs is their
// user's (team B's owner's).
func (e *matrixEnv) ownFor(t *testing.T, c caller) *ownObjects {
	if e.own[c] != nil {
		return e.own[c]
	}
	o := &ownObjects{conv: e.b.conv, message: e.b.message}
	switch c {
	case cAnon, cServiceKey, cPublishable, cKeyIngest, cKeyManage:
	default:
		o.conv, o.message = e.newConversation(t, c)
	}
	if e.actors[c].csrf != "" {
		code, raw := e.send(t, c, get("/v1/notifications"))
		var page struct{ Data any }
		if code == 200 && json.Unmarshal(raw, &page) == nil {
			o.notification = field(page.Data, "items.0.id")
		}
	}
	e.own[c] = o
	return o
}

// newConversation has c chat with team B's public agent.
func (e *matrixEnv) newConversation(t *testing.T, c caller) (conv, message string) {
	t.Helper()
	code, raw := e.send(t, c, post("/v1/agents/"+e.b.slug+"/"+e.b.agentSl+"/chat", map[string]any{"message": "Where do students buy a parking permit?", "stream": false}))
	var env struct{ Data any }
	if code != 200 || json.Unmarshal(raw, &env) != nil || field(env.Data, "conversationId") == "" {
		t.Fatalf("chat as %s = %d %s", c, code, raw)
	}
	return field(env.Data, "conversationId"), field(env.Data, "messageId")
}

// ---- the test ------------------------------------------------------------------------

// run is one pass over an operation: its target team and callers.
type run struct {
	name    string
	foreign bool
	callers callers
}

func runsFor(s scope) []run {
	teamB := members.and(allKeys, of(cPublishable))
	switch s {
	case scopeTeam:
		return []run{{"own", false, teamB}, {"foreign", true, everyone}}
	case scopeUser, scopePublic:
		return []run{{"own", false, everyone}, {"foreign", true, everyone}}
	default:
		return []run{{"global", false, everyone}}
	}
}

// The matrix tests run in their own CI job (the "authz" job in
// .github/workflows/ci.yml; `make test-authz`), in parallel with each
// other: each has its own database, Valkey prefix and server.
func TestAuthorizationMatrix(t *testing.T) {
	t.Parallel()
	ops := specOperations(t)
	if missing := unclassified(ops); len(missing) > 0 {
		t.Fatalf("unclassified operations (add them to matrixPolicies): %v", missing)
	}
	e := newMatrixEnv(t)
	calls := 0
	for _, op := range ops {
		p := matrixPolicies[op]
		for _, rn := range runsFor(p.scope) {
			for c := caller(0); c < numCallers; c++ {
				if rn.callers.has(c) && e.check(t, op, p, rn, c) {
					calls++
				}
			}
		}
	}
	e.checkTeamAIntact(t)
	t.Logf("authorization matrix: %d operations × %d callers, %d calls", len(ops), numCallers, calls)
}

// cell is one call of the matrix.
type cell struct {
	op, run string
	p       policy
	who     caller
	tf      *teamFix
	foreign bool
	allowed bool
	// contentOK: team A's content may appear (break-glass reads in scope).
	contentOK bool
}

// check runs one cell of a run and reports whether a call was made.
func (e *matrixEnv) check(t *testing.T, op string, p policy, rn run, c caller) bool {
	t.Helper()
	cl := cell{op: op, run: rn.name, p: p, who: c, tf: e.b, allowed: p.own.has(c)}
	if rn.foreign {
		cl.tf, cl.foreign, cl.allowed = e.a, true, p.foreign.has(c)
	}
	return e.call(t, cl)
}

// call makes one call and checks its status and body.
func (e *matrixEnv) call(t *testing.T, cl cell) bool {
	t.Helper()
	p, c := cl.p, cl.who
	r := p.build(&mctx{e: e, t: t, who: c, tf: cl.tf, foreign: cl.foreign, allowed: cl.allowed})
	if r.skip != "" {
		t.Logf("%s/%s as %s: skipped (%s)", cl.op, cl.run, c, r.skip)
		return false
	}
	code, raw := e.send(t, c, r)
	where := fmt.Sprintf("%s (%s %s) %s as %s", cl.op, r.method, r.path, cl.run, c)
	errCode := errorCode(raw)
	switch {
	case code >= 500:
		t.Errorf("%s: %d %s", where, code, raw)
	case p.anyStatus:
	case cl.allowed && !succeeded(code, errCode, p.also):
		t.Errorf("%s: got %d %s, want success", where, code, clip(raw))
	case !cl.allowed && !denied(code, errCode):
		t.Errorf("%s: got %d %s, want 401, 403 or 404", where, code, clip(raw))
	}
	ok := cl.allowed && !p.anyStatus && code < 300
	if leaked := e.leaks(c, r, raw, ok, cl.contentOK && ok); len(leaked) > 0 {
		t.Errorf("%s: response (%d) contains team A data %v: %s", where, code, leaked, clip(raw))
	}
	return true
}

func succeeded(code int, errCode string, also []string) bool {
	if code >= 200 && code < 400 {
		return true
	}
	for _, a := range also {
		want, wantCode, _ := strings.Cut(a, " ")
		if want == strconv.Itoa(code) && (wantCode == "" || wantCode == errCode) {
			return true
		}
	}
	return false
}

// denied: no credentials (401), not allowed (403), or not visible (404).
// Credentials sent to the anonymous API are refused with 400.
func denied(code int, errCode string) bool {
	return code == 401 || code == 403 || code == 404 || (code == 400 && errCode == "credentials_not_accepted")
}

// leaks returns team A markers in a response. Platform readers may see
// team A's names and IDs where the call is allowed; content only when
// contentOK (break-glass).
func (e *matrixEnv) leaks(c caller, r request, raw []byte, allowed, contentOK bool) []string {
	body := string(raw)
	var found []string
	if !contentOK && strings.Contains(body, contentMarker) {
		found = append(found, contentMarker)
	}
	if allowed && platform.has(c) {
		return found
	}
	if strings.Contains(body, nameMarker) {
		found = append(found, nameMarker)
	}
	sent, _ := json.Marshal(r.body)
	for _, id := range e.a.ids {
		if id != "" && strings.Contains(body, id) && !strings.Contains(r.path, id) && !bytes.Contains(sent, []byte(id)) {
			found = append(found, id)
		}
	}
	return found
}

func clip(raw []byte) string {
	if len(raw) > 300 {
		return string(raw[:300]) + "…"
	}
	return string(raw)
}

// checkTeamAIntact: every denied write left team A's objects in place.
func (e *matrixEnv) checkTeamAIntact(t *testing.T) {
	t.Helper()
	a, base := e.a, "/v1/teams/"+e.a.slug
	for _, p := range []string{
		base + "/sources/" + a.source, base + "/sources/" + a.source + "/documents/" + a.doc, base + "/sources/" + a.web,
		base + "/kbs/" + a.kb, base + "/agents/" + a.agent, "/v1/conversations/" + a.conv,
	} {
		if code, raw := a.owner.raw("GET", p, nil, nil); code != 200 {
			t.Errorf("team A's %s after the matrix = %d %s", p, code, clip(raw))
		}
	}
	lists := map[string]string{base + "/api-keys": a.serviceKey, base + "/invites": a.invite, base + "/members": a.memberID,
		base + "/agents/" + a.agent + "/publishable-keys": a.pubKey}
	for p, id := range lists {
		if _, raw := a.owner.raw("GET", p, nil, nil); !strings.Contains(string(raw), id) {
			t.Errorf("team A's %s no longer lists %s", p, id)
		}
	}
	var st struct{ Data struct{ Status string } }
	_, raw := a.owner.raw("GET", base+"/agents/"+a.agent, nil, nil)
	if json.Unmarshal(raw, &st); st.Data.Status != "active" {
		t.Errorf("team A's agent status = %q", st.Data.Status)
	}
}

// unclassified lists spec operations missing from matrixPolicies, and
// policies for operations the spec no longer has.
func unclassified(ops []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, op := range ops {
		seen[op] = true
		if _, ok := matrixPolicies[op]; !ok {
			out = append(out, op)
		}
	}
	for op := range matrixPolicies {
		if !seen[op] {
			out = append(out, op+" (classified, but not in the spec)")
		}
	}
	sort.Strings(out)
	return out
}
