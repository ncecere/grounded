package httpapi_test

import (
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The notice that a request was approved says where the team is and who owns it: a requester who named another owner is not a member of the
// team, so it must not send them to a page that says "Team not found" (QA pass v0.6.0, #136).
func TestApprovalNoticeNamesAnotherOwner(t *testing.T) {
	e := newReqEnv(t)
	e.configure(t, true, 9, "")

	approve := func(name, owner, slug string) {
		t.Helper()
		body := map[string]any{"name": name, "purpose": "Run " + name + " together.", "classification": "open"}
		if owner != "" {
			body["ownerEmail"] = owner
		}
		var asked apitypes.TeamRequest
		code, c := e.user.call("POST", "/v1/team-requests", body, &asked, nil)
		mustCode(t, "ask for "+name, code, c, 201, "")
		req, rev := e.adminRequest(t, asked.Id.String())
		code, c = e.admin.call("POST", "/v1/admin/team-requests/"+req.Id.String()+"/approve", map[string]any{"slug": slug}, nil, ifMatch(rev))
		mustCode(t, "approve "+name, code, c, 200, "")
	}
	// The newest "request decided" notice (a membership notice may arrive beside it).
	latest := func() (title, link, body string) {
		t.Helper()
		for _, n := range inbox(t, e.user, url.Values{"limit": {"10"}}).Items {
			if string(n.Type) == "team.request_decided" {
				return n.Title, n.Link, n.Body
			}
		}
		t.Fatal("the requester has no team.request_decided notification")
		return "", "", ""
	}

	// The requester owns it: the team is theirs, and the notice links to it.
	approve("Mine", "", "mine-team")
	if _, link, body := latest(); link != "/teams/mine-team" || strings.Contains(body, "owner") {
		t.Errorf("own team: link %q, body %q; want the team's page and no owner named", link, body)
	}

	// Naming themselves as the owner (in any case) is the same thing.
	approve("Mine named", "User@Localhost", "mine-named-team")
	if _, link, body := latest(); link != "/teams/mine-named-team" || strings.Contains(body, "owner") {
		t.Errorf("own team, named: link %q, body %q; want the team's page and no owner named", link, body)
	}

	// Another person owns it: the notice names them and does not link to a team the requester cannot open.
	approve("For Casey", "Casey@Localhost", "for-casey-team")
	_, link, body := latest()
	if link != "/team-requests" {
		t.Errorf("a team owned by someone else: link %q, want /team-requests (the requester is not a member)", link)
	}
	if !strings.Contains(body, "casey@localhost") || !strings.Contains(body, "owner") {
		t.Errorf("a team owned by someone else: body %q does not say who owns it", body)
	}

	// A newcomer, invited as owner, is named the same way.
	approve("For a newcomer", "newcomer@example.edu", "newcomer-team")
	_, link, body = latest()
	if link != "/team-requests" || !strings.Contains(body, "newcomer@example.edu") {
		t.Errorf("a team owned by an invited newcomer: link %q body %q", link, body)
	}
}
