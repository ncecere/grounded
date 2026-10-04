package httpapi_test

import "fmt"

// Classification of the team routes (/v1/teams/{team}/…), DESIGN.md §3.3
// and §3.5: members use a team's agents and knowledge bases and read its
// sources; editors build; team admins and owners manage members, keys and
// sharing. API keys act with the role their scopes stand for (query as
// member, ingest as editor, manage as admin), only on `either` routes,
// and chat and retrieval need the query scope. Platform admins and
// auditors read a team's metadata, never its content (break-glass is
// tested separately).

var (
	// readKeys: any key reads the team's objects on `either` routes.
	readKeys = allKeys
	// ingestKeys: keys acting as editor or above.
	ingestKeys = of(cKeyIngest, cKeyManage, cServiceKey)
	// queryKeys: keys with the query scope (chat, retrieval, directory).
	queryKeys = of(cKeyQuery, cServiceKey)
)

const upd = "updated by the authorization matrix"

func init() {
	for id, p := range teamPolicies {
		p.scope = scopeTeam
		register(id, p)
	}
}

var teamPolicies = map[string]policy{
	// Teams, members, invites, audit, limits.
	"getTeam":     {own: members, foreign: platform, build: func(c *mctx) request { return get(c.team("")) }},
	"listMembers": {own: members, foreign: platform, build: func(c *mctx) request { return get(c.team("/members")) }},
	"addMember": {own: admins, build: func(c *mctx) request {
		return post(c.team("/members"), map[string]any{"email": c.e.freshUser(c.t).me.User.Email, "role": "member"})
	}},
	"updateMember": {own: admins, build: func(c *mctx) request {
		id := c.pick(c.tf.memberID, c.e.freshMember)
		return patch(c.team("/members/"+id), map[string]any{"role": "editor"}).h(c.memberRev(id))
	}},
	"removeMember":  {own: admins, build: func(c *mctx) request { return del(c.team("/members/" + c.pick(c.tf.memberID, c.e.freshMember))) }},
	"listInvites":   {own: admins, foreign: platform, build: func(c *mctx) request { return get(c.team("/invites")) }},
	"revokeInvite":  {own: admins, foreign: padmin, build: func(c *mctx) request { return del(c.team("/invites/" + c.pick(c.tf.invite, c.e.freshInvite))) }},
	"listTeamAudit": {own: editors, foreign: platform, build: func(c *mctx) request { return get(c.team("/audit")) }},
	"getTeamAuditEntry": {own: editors, foreign: platform, build: func(c *mctx) request {
		return get(c.team("/audit/" + c.tf.auditID))
	}},
	"getTeamLimits": {own: members, foreign: platform, build: func(c *mctx) request { return get(c.team("/limits")) }},

	// API keys.
	"listAPIKeys": {own: members, build: func(c *mctx) request { return get(c.team("/api-keys")) }},
	"createAPIKey": {own: members, build: func(c *mctx) request {
		return post(c.team("/api-keys"), map[string]any{"name": "matrix", "scopes": []string{"query"}})
	}},
	// A service key: team admins see it; other members only their own keys.
	"getAPIKey": {own: admins, build: func(c *mctx) request { return get(c.team("/api-keys/" + c.tf.serviceKey)) }},
	"updateAPIKeyContact": {own: admins, build: func(c *mctx) request {
		return patch(c.team("/api-keys/"+c.tf.serviceKey), map[string]any{"responsibleUserId": c.tf.owner.me.User.Id})
	}},
	"revokeAPIKey": {own: admins, build: func(c *mctx) request {
		return del(c.team("/api-keys/" + c.pick(c.tf.serviceKey, c.e.freshServiceKey)))
	}},

	// Sources, documents, crawls.
	"listSources": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.team("/sources")) }},
	"createSource": {own: editors, build: func(c *mctx) request {
		return post(c.team("/sources"), map[string]any{"name": fmt.Sprintf("matrix source %d", c.e.next()), "classification": "open"})
	}},
	"getSource": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.src("")) }},
	"updateSource": {own: editors, build: func(c *mctx) request {
		return patch(c.src(""), map[string]any{"description": upd}).h(c.rev(c.src("")))
	}},
	"deleteSource":  {own: editors, build: func(c *mctx) request { return del(c.team("/sources/" + c.pick(c.tf.source, c.e.freshSource))) }},
	"listDocuments": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.src("/documents")) }},
	"uploadDocuments": {own: editors.and(ingestKeys), build: func(c *mctx) request {
		return request{method: "POST", path: c.src("/documents"), files: []upload{{"matrix.md", []byte("# Matrix\n\nUploaded.\n")}}}
	}},
	"getDocument": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.src("/documents/" + c.tf.doc)) }},
	"updateDocument": {own: editors, build: func(c *mctx) request {
		return patch(c.src("/documents/"+c.tf.doc), map[string]any{"tags": []string{"matrix"}})
	}},
	"deleteDocument": {own: editors, build: func(c *mctx) request {
		return del(c.src("/documents/" + c.pick(c.tf.doc, c.e.freshDoc)))
	}},
	"listDocumentPassages": {own: members.and(readKeys), build: func(c *mctx) request {
		return get(c.src("/documents/" + c.tf.doc + "/passages"))
	}},
	// The whole document (the source viewer): editors and above, and keys
	// acting as editors; members see only passages their answers cited.
	"getDocumentText": {own: editors.and(ingestKeys), build: func(c *mctx) request {
		return get(c.src("/documents/" + c.tf.doc + "/text?limit=5"))
	}},
	"listSourceTags": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.src("/tags")) }},
	"retryDocument": {own: editors, also: []string{"409"}, build: func(c *mctx) request {
		return post(c.src("/documents/"+c.tf.doc+"/retry"), nil)
	}},
	"retryDocuments": {own: editors, build: func(c *mctx) request {
		return post(c.src("/documents/retry"), map[string]any{"errorCode": "needs_ocr"})
	}},
	"refetchDocument": {own: editors, also: []string{"409"}, build: func(c *mctx) request {
		return post(c.web("/documents/"+c.tf.webDoc+"/refetch"), nil)
	}},
	"syncSource":            {own: editors.and(ingestKeys), also: []string{"409"}, build: func(c *mctx) request { return post(c.web("/sync"), nil) }},
	"listBoilerplateBlocks": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.web("/boilerplate")) }},
	"listCrawls":            {own: members.and(readKeys), build: func(c *mctx) request { return get(c.web("/crawls")) }},
	"cancelCrawl": {own: editors.and(ingestKeys), also: []string{"409"}, build: func(c *mctx) request {
		return post(c.web("/crawls/"+c.tf.crawl+"/cancel"), nil)
	}},
	"mapSite": {own: editors.and(ingestKeys), build: func(c *mctx) request {
		return post(c.team("/web/map"), map[string]any{"url": c.e.site.url("/"), "limit": 2})
	}},
	"listTeamDomainRequests": {own: members, build: func(c *mctx) request { return get(c.team("/domain-requests")) }},
	"createDomainRequest": {own: editors, build: func(c *mctx) request {
		return post(c.team("/domain-requests"), map[string]any{"pattern": fmt.Sprintf("m%d.example.org", c.e.next()), "reason": "The matrix needs this site"})
	}},
	// The requester or a team admin or owner; the fixture's requester is the
	// owner, so editors and members are refused (a requester who is an
	// editor is tested in domain_withdraw_integration_test.go).
	"withdrawDomainRequest": {own: admins, build: func(c *mctx) request {
		return del(c.team("/domain-requests/" + c.pick(c.tf.domainRequest, c.e.freshDomainRequest)))
	}},

	// Knowledge bases.
	"listKnowledgeBases": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.team("/kbs")) }},
	"createKnowledgeBase": {own: editors, build: func(c *mctx) request {
		return post(c.team("/kbs"), map[string]any{"name": fmt.Sprintf("matrix kb %d", c.e.next())})
	}},
	"getKnowledgeBase": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.kb("")) }},
	"updateKnowledgeBase": {own: editors, build: func(c *mctx) request {
		return patch(c.kb(""), map[string]any{"description": upd}).h(c.rev(c.kb("")))
	}},
	"deleteKnowledgeBase": {own: editors, build: func(c *mctx) request { return del(c.team("/kbs/" + c.pick(c.tf.kb, c.e.freshKB))) }},
	"attachSource": {own: editors, build: func(c *mctx) request {
		return put(c.team("/kbs/"+c.pick(c.tf.kb, c.e.freshKB)+"/sources/"+c.tf.web), nil)
	}},
	"detachSource": {own: editors, build: func(c *mctx) request {
		kb := c.tf.kb
		if c.allowed {
			kb = c.e.freshKB(c.t, c.tf)
			must(c.t, c.tf.owner, "PUT", c.team("/kbs/"+kb+"/sources/"+c.tf.source), nil, nil)
		}
		return del(c.team("/kbs/" + kb + "/sources/" + c.tf.source))
	}},
	"getKnowledgeBaseProfileMigration": {own: members, build: func(c *mctx) request { return get(c.kb("/profile-migration")) }},
	"retrieve": {own: members.and(queryKeys), build: func(c *mctx) request {
		return post(c.kb("/retrieve"), map[string]any{"query": "parking permit"})
	}},
}
