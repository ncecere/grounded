package httpapi_test

import (
	"sort"
	"testing"
)

// Break-glass in the authorization matrix (ADR-0024, DESIGN.md §3.6): a
// platform admin without a session gets none of a team's content; with
// one, exactly the reads of its scope on its team, and still no writes,
// exports or other teams. Every team and per-user operation is called as
// the platform admin on team A (the session's team) and on team B (not in
// the session) for each scope.

// breakGlassReads are the operations a session's scope opens on its team,
// as reads (DESIGN.md §3.6: "documents" is data sources, documents,
// passages, tags, crawl history and repeated blocks; "conversations" is
// the list of the team's conversations and their transcripts).
var breakGlassReads = map[string]map[string]bool{
	"documents": {
		"listSources": true, "getSource": true, "listDocuments": true, "getDocument": true, "listDocumentPassages": true,
		"getDocumentText": true, "listSourceTags": true, "listCrawls": true, "listBoilerplateBlocks": true,
	},
	"conversations": {"listTeamConversations": true, "getConversation": true},
}

// publicAgentUse: team B's agent is public, so anyone signed in may use it
// with or without a session.
var publicAgentUse = map[string]bool{"getAgentProfile": true, "chat": true, "openaiChatCompletions": true}

func TestAuthorizationMatrixBreakGlass(t *testing.T) {
	t.Parallel() // with TestAuthorizationMatrix, on its own database
	e := newMatrixEnv(t)
	ops := specOperations(t)
	scopes := []string{"documents", "conversations"}
	for _, scope := range scopes {
		for op := range breakGlassReads[scope] {
			if _, ok := matrixPolicies[op]; !ok {
				t.Fatalf("break-glass read %s is not an operation", op)
			}
		}
	}
	sort.Strings(scopes)
	calls := 0
	for _, scope := range scopes {
		e.endOpenBreakGlass(t)
		startBreakGlass(t, e.admin, e.a.slug, scope)
		for _, op := range ops {
			p := matrixPolicies[op]
			if p.scope != scopeTeam && p.scope != scopeUser {
				continue
			}
			in := breakGlassReads[scope][op]
			// On the session's team: the classified platform reads, plus
			// the scope's content reads.
			if e.call(t, cell{op: op, run: "break-glass " + scope + " on team A", p: p, who: cPlatformAdmin, tf: e.a, foreign: true,
				allowed: p.foreign.has(cPlatformAdmin) || in, contentOK: in}) {
				calls++
			}
			// Another team: nothing more than without a session.
			if p.scope == scopeTeam && e.call(t, cell{op: op, run: "break-glass " + scope + " on team B", p: p, who: cPlatformAdmin, tf: e.b,
				foreign: true, allowed: p.foreign.has(cPlatformAdmin) || publicAgentUse[op]}) {
				calls++
			}
		}
	}
	// Ended: back to no content.
	e.endOpenBreakGlass(t)
	for scope := range breakGlassReads {
		for op := range breakGlassReads[scope] {
			p := matrixPolicies[op]
			if e.call(t, cell{op: op, run: "after break-glass", p: p, who: cPlatformAdmin, tf: e.a, foreign: true, allowed: p.foreign.has(cPlatformAdmin)}) {
				calls++
			}
		}
	}
	e.checkTeamAIntact(t)
	t.Logf("break-glass matrix: %d calls", calls)
}
