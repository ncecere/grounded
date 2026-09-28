package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// groupMappingRoutes: SSO group → team role rules (docs/operations/sso-groups.md).
func (a *api) groupMappingRoutes() []route {
	return []route{
		{"GET", "/v1/admin/group-mapping", a.admin(a.adminGetGroupMapping)},
		{"GET", "/v1/admin/group-mapping/rules", a.admin(a.adminListGroupRules)},
		{"POST", "/v1/admin/group-mapping/rules", a.admin(a.adminCreateGroupRule)},
		{"POST", "/v1/admin/group-mapping/preview", a.admin(a.adminPreviewGroupRule)},
		{"GET", "/v1/admin/group-mapping/rules/{ruleId}", a.admin(a.adminGetGroupRule)},
		{"PATCH", "/v1/admin/group-mapping/rules/{ruleId}", a.admin(a.adminUpdateGroupRule)},
		{"DELETE", "/v1/admin/group-mapping/rules/{ruleId}", a.admin(a.adminDeleteGroupRule)},
	}
}

func toAPIGroupRule(v ssogroups.RuleView) apitypes.GroupRule {
	r := v.SsoGroupRule
	return apitypes.GroupRule{
		Id: r.ID, Group: r.GroupName, Role: apitypes.TeamRole(r.Role),
		Team:       apitypes.TeamRef{Id: r.TeamID, Slug: v.TeamSlug, Name: v.TeamName},
		TeamStatus: apitypes.TeamStatus(v.TeamStatus), MemberCount: v.MemberCount,
		Revision: r.Revision, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func memberUser(u dbgen.User) apitypes.MemberUser {
	return apitypes.MemberUser{Id: u.ID, Email: u.Email, DisplayName: u.DisplayName, Status: apitypes.UserStatus(u.Status)}
}

func roleRef(role string) *apitypes.TeamRole {
	if role == "" {
		return nil
	}
	r := apitypes.TeamRole(role)
	return &r
}

func (a *api) adminGetGroupMapping(w http.ResponseWriter, r *http.Request) {
	st, err := a.groups.Status(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.GroupMappingStatus{
		GroupsClaim: st.GroupsClaim, OidcEnabled: st.OIDCEnabled, RuleCount: st.Stats.RuleCount,
		PeopleSeen: st.Stats.PeopleSeen, PeopleWithClaim: st.Stats.PeopleWithClaim, LastClaimAt: st.LastClaimAt,
		RecentSignIns: st.Stats.RecentSignIns, RecentWithClaim: st.Stats.RecentWithClaim,
		Groups: make([]apitypes.SeenGroup, len(st.Groups)),
	}
	for i, g := range st.Groups {
		out.Groups[i] = apitypes.SeenGroup{Name: g.Name, People: g.People}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminListGroupRules(w http.ResponseWriter, r *http.Request) {
	rules, err := a.groups.List(r.Context(), a.actor(r), r.URL.Query().Get("team"))
	writeList(w, r, rules, err, toAPIGroupRule)
}

func (a *api) adminGetGroupRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "ruleId")
	if !ok {
		return
	}
	v, err := a.groups.Get(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.SsoGroupRule.Revision, toAPIGroupRule(v))
}

func (a *api) adminCreateGroupRule(w http.ResponseWriter, r *http.Request) {
	var in apitypes.GroupRuleCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	v, err := a.groups.Create(r.Context(), a.actor(r), ssogroups.RuleInput{Group: in.Group, Team: in.Team, Role: string(in.Role)})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, v.SsoGroupRule.Revision, toAPIGroupRule(v))
}

func (a *api) adminUpdateGroupRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "ruleId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.GroupRuleUpdate](w, r)
	if !ok {
		return
	}
	upd := ssogroups.RuleUpdate{Group: in.Group}
	if in.Role != nil {
		role := string(*in.Role)
		upd.Role = &role
	}
	v, err := a.groups.Update(r.Context(), a.actor(r), id, upd, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.SsoGroupRule.Revision, toAPIGroupRule(v))
}

func (a *api) adminDeleteGroupRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "ruleId")
	if !ok {
		return
	}
	writeOK(w, r, a.groups.Delete(r.Context(), a.actor(r), id))
}

func (a *api) adminPreviewGroupRule(w http.ResponseWriter, r *http.Request) {
	var in apitypes.GroupRulePreviewRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	p := ssogroups.PreviewInput{Delete: in.Delete != nil && *in.Delete}
	if in.RuleId != nil {
		p.RuleID = uuid.NullUUID{UUID: *in.RuleId, Valid: true}
	}
	if in.Group != nil {
		p.Group = *in.Group
	}
	if in.Team != nil {
		p.Team = *in.Team
	}
	if in.Role != nil {
		p.Role = string(*in.Role)
	}
	res, err := a.groups.Preview(r.Context(), a.actor(r), p)
	if failed(w, r, err) {
		return
	}
	out := apitypes.GroupRulePreview{
		Team:    apitypes.TeamRef{Id: res.Team.ID, Slug: res.Team.Slug, Name: res.Team.Name},
		Changes: make([]apitypes.GroupRuleChange, len(res.Items)),
	}
	for i, it := range res.Items {
		c := it.Change
		to := c.To
		if c.Kind == ssogroups.KindManual && c.Rule != nil {
			to = c.Rule.Role // what the rule would give; the membership keeps its role
		}
		out.Changes[i] = apitypes.GroupRuleChange{
			User: memberUser(it.User), Kind: apitypes.GroupRuleChangeKind(c.Kind),
			From: roleRef(c.From), To: roleRef(to), GroupsSeenAt: it.GroupsSeenAt,
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}
