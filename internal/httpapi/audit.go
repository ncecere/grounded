package httpapi

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Audit log reads (DESIGN.md §13): the team and platform logs share these
// filters and the entry format, with the actor and target names resolved at
// read time.

// groupMappingActions is the action filter for SSO group mapping: the rules'
// changes and the memberships they made, which span action groups.
const groupMappingActions = "group_mapping."

// auditAreas are action filters spanning groups (docs/mcp.md, docs/mcp-client.md):
// an entry is in the area when its action starts with one of the prefixes and
// with none of the exclusions.
var auditAreas = map[string]struct{ any, exclude []string }{
	// What AI tools did over Grounded's MCP server (search, ask), not agents' calls out.
	"mcp_clients.": {any: []string{"mcp."}, exclude: []string{"mcp.tool_call"}},
	// Agents' MCP tools: their calls, the servers and the tools' approval.
	"agent_tools.": {any: []string{"mcp.tool_call", "mcp_server.", "mcp_tool."}},
}

var (
	auditActionRe     = regexp.MustCompile(`^[a-z][a-z_]*\.[a-z_]*$`)
	auditExcludeRe    = regexp.MustCompile(`^[a-z][a-z_]*\.(,[a-z][a-z_]*\.)*$`)
	auditTargetTypeRe = regexp.MustCompile(`^[a-z_]{1,64}$`)
)

// auditFilters reads ?action=, ?excludeAction=, ?actorUserId=, ?actorKind=, ?targetType=,
// ?from= and ?to= into p. An action ending in "." matches every action in
// that group; excludeAction is one or more groups, comma-separated ("auth."
// hides sign-ins; "auth.,mcp." also the MCP server's tool calls).
func auditFilters(w http.ResponseWriter, r *http.Request, p *dbgen.ListAuditParams) bool {
	q := r.URL.Query()
	if v := q.Get("action"); v != "" {
		if len(v) > 100 || !auditActionRe.MatchString(v) {
			httpx.Error(w, http.StatusBadRequest, "invalid_action", "action must be an action such as agent.publish, or a group prefix such as agent.")
			return false
		}
		area, isArea := auditAreas[v]
		switch {
		case v == groupMappingActions:
			p.GroupMapping = pgtype.Bool{Bool: true, Valid: true}
		case isArea:
			for _, x := range area.any {
				p.AnyPrefixes = append(p.AnyPrefixes, store.EscapeLike(x))
			}
			for _, x := range area.exclude {
				p.ExcludePrefixes = append(p.ExcludePrefixes, store.EscapeLike(x))
			}
		case strings.HasSuffix(v, "."):
			prefix := store.EscapeLike(v)
			p.ActionPrefix = &prefix
		default:
			p.Action = &v
		}
	}
	if v := q.Get("excludeAction"); v != "" {
		if len(v) > 100 || !auditExcludeRe.MatchString(v) {
			httpx.Error(w, http.StatusBadRequest, "invalid_action", "excludeAction must be action groups such as auth. or auth.,mcp.")
			return false
		}
		for _, group := range strings.Split(v, ",") {
			p.ExcludePrefixes = append(p.ExcludePrefixes, store.EscapeLike(group))
		}
	}
	if v := q.Get("actorUserId"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_actor", "actorUserId must be a user ID")
			return false
		}
		p.ActorUserID = uuid.NullUUID{UUID: id, Valid: true}
	}
	switch v := q.Get("actorKind"); v {
	case "":
	case "system", "group_mapping":
		p.ActorKind = &v
	default:
		httpx.Error(w, http.StatusBadRequest, "invalid_actor_kind", "actorKind must be system or group_mapping")
		return false
	}
	if v := q.Get("targetType"); v != "" {
		if !auditTargetTypeRe.MatchString(v) {
			httpx.Error(w, http.StatusBadRequest, "invalid_target_type", "targetType must be a target type such as knowledge_base")
			return false
		}
		p.TargetType = &v
	}
	return auditRange(w, r, p)
}

// auditRange reads the time window: from is inclusive, to exclusive.
func auditRange(w http.ResponseWriter, r *http.Request, p *dbgen.ListAuditParams) bool {
	for _, f := range []struct {
		name string
		dst  **time.Time
	}{{"from", &p.OccurredFrom}, {"to", &p.OccurredTo}} {
		raw := r.URL.Query().Get(f.name)
		if raw == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_range", f.name+" must be an RFC 3339 date-time")
			return false
		}
		*f.dst = &t
	}
	if p.OccurredFrom != nil && p.OccurredTo != nil && !p.OccurredFrom.Before(*p.OccurredTo) {
		httpx.Error(w, http.StatusBadRequest, "invalid_range", "from must be before to")
		return false
	}
	return true
}

// writeAuditPage serves one page of audit entries, newest first, within
// scope (a team, and whether its cost entries are left out).
func (a *api) writeAuditPage(w http.ResponseWriter, r *http.Request, scope dbgen.ListAuditParams) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 1)
	if !ok {
		return
	}
	p := dbgen.ListAuditParams{TeamID: scope.TeamID, HideSpend: scope.HideSpend, PageSize: limit + 1}
	if keys != nil {
		before, err := strconv.ParseInt(keys[0], 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		p.BeforeID = &before
	}
	if !auditFilters(w, r, &p) {
		return
	}
	rows, err := a.q.ListAudit(r.Context(), p)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	page := apitypes.AuditPage{Items: []apitypes.AuditEntry{}}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		page.NextCursor = encodeCursor(strconv.FormatInt(rows[len(rows)-1].ID, 10))
	}
	for _, e := range rows {
		page.Items = append(page.Items, toAPIAudit(e, !scope.TeamID.Valid))
	}
	httpx.JSON(w, http.StatusOK, page)
}

// toAPIAudit converts one entry; platform is whether it is read in the
// platform log (the caller's address is shown there only).
func toAPIAudit(e dbgen.ListAuditRow, platform bool) apitypes.AuditEntry {
	out := apitypes.AuditEntry{
		Id: e.ID, OccurredAt: e.OccurredAt, ActorKind: apitypes.AuditEntryActorKind(e.ActorKind),
		Actor:  toAPIAuditActor(e),
		Action: e.Action, TargetType: e.TargetType, TargetId: e.TargetID, RequestId: e.RequestID,
		ActorUserId: nullUUID(e.ActorUserID), TeamId: nullUUID(e.TeamID),
		TargetExists: e.LiveLabel != "",
		Metadata:     map[string]any{},
	}
	if e.TeamName != "" {
		out.TeamName, out.TeamSlug = &e.TeamName, &e.TeamSlug
	}
	// Names are never empty, so "" means the label is unknown.
	if e.LiveLabel != "" {
		out.TargetLabel = &e.LiveLabel
	} else if e.RecordedLabel != "" {
		out.TargetLabel = &e.RecordedLabel
	}
	out.Parent = toAPIAuditParent(e)
	if len(e.BeforeState) > 0 {
		out.Before = e.BeforeState
	}
	if len(e.AfterState) > 0 {
		out.After = e.AfterState
	}
	_ = json.Unmarshal(e.Metadata, &out.Metadata)
	out.Via = auditVia(e, out.Metadata)
	if platform && e.ClientIP != "" {
		out.ClientIp = &e.ClientIP
	}
	return out
}

// auditVia says how the person acted: with an API key (the key's actor
// kind), through a connected app (metadata via: oauth, authz.Actor.Audit),
// or otherwise signed in to Grounded. Nil for the system's entries.
func auditVia(e dbgen.ListAuditRow, meta map[string]any) *apitypes.AuditVia {
	switch {
	case e.ActorKind == "api_key":
		return &apitypes.AuditVia{Kind: apitypes.AuditViaKindApiKey, Name: e.ActorApiKeyName}
	case meta["via"] == "oauth":
		v := &apitypes.AuditVia{Kind: apitypes.AuditViaKindOauth}
		if name, ok := meta["oauthClient"].(string); ok && name != "" {
			v.Name = &name
		}
		return v
	case e.ActorKind == "user" && e.ActorUserID.Valid:
		return &apitypes.AuditVia{Kind: apitypes.AuditViaKindSession}
	}
	return nil
}

// toAPIAuditParent links a target to the object it belongs to (a widget
// key's agent, a document's source), or nil.
func toAPIAuditParent(e dbgen.ListAuditRow) *apitypes.AuditParent {
	id, err := uuid.Parse(e.ParentID)
	if e.ParentType == "" || err != nil {
		return nil
	}
	p := &apitypes.AuditParent{Type: apitypes.AuditParentType(e.ParentType), Id: id, Exists: e.ParentLabel != ""}
	if e.ParentLabel != "" {
		p.Label = &e.ParentLabel
	}
	return p
}

func toAPIAuditActor(e dbgen.ListAuditRow) apitypes.AuditActor {
	actor := apitypes.AuditActor{Kind: apitypes.AuditActorKind(e.ActorKind), UserId: nullUUID(e.ActorUserID)}
	if e.ActorEmail != "" {
		actor.Email = &e.ActorEmail
	}
	if e.ActorDisplayName != nil && *e.ActorDisplayName != "" {
		actor.DisplayName = e.ActorDisplayName
	}
	if e.ActorApiKeyName != nil {
		actor.ApiKeyName = e.ActorApiKeyName
	}
	return actor
}
