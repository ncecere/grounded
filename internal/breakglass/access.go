// Reads under a session: the grant check every content read by a non-member
// goes through, and its audit entry.

package breakglass

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Read kinds: what a read under a session looked at. The audit entry names
// the kind and the target (a team, source, document or conversation ID),
// never content.
const (
	ReadConversationList = "conversation_list"
	ReadConversation     = "conversation"
	ReadSourceList       = "source_list"
	ReadSource           = "source"
	ReadDocumentList     = "document_list"
	ReadDocument         = "document"
	ReadPassages         = "passages"
	ReadTags             = "tags"
	ReadCrawls           = "crawls"
	ReadBoilerplate      = "boilerplate"
)

// Read is one content read a non-member asks for.
type Read struct {
	Kind       string
	TargetType string // team, data_source, document or conversation
	TargetID   string
}

// scope is the session scope a read kind needs.
func (r Read) scope() string {
	if r.Kind == ReadConversationList || r.Kind == ReadConversation {
		return authz.BreakGlassConversations
	}
	return authz.BreakGlassDocuments
}

// Authorize decides a read of team's content by an actor who is not a
// member. With an active session that grants it (authz
// BreakGlassSession.Allows, checked now), it records the read in audit_log
// (breakglass.read, in the team's log too) and returns the session; the
// read must not go ahead if recording fails. Without one it returns nil and
// the caller answers as it would to any non-member. The grant is read from
// the database on every call, so ending a session takes effect at once.
func (s *Service) Authorize(ctx context.Context, a authz.Actor, team uuid.UUID, r Read) (*authz.BreakGlassSession, error) {
	if s == nil || a.Key != nil || !a.IsPlatformAdmin() || a.UserID == uuid.Nil {
		return nil, nil
	}
	row, err := s.q.ActiveBreakGlassGrant(ctx, dbgen.ActiveBreakGlassGrantParams{AdminID: a.UserID, TeamID: team})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	g := authz.BreakGlassSession{
		ID: row.ID, TeamID: row.TeamID, RequestedBy: row.RequestedBy, Scopes: row.Scopes, Status: row.Status,
		StartedAt: row.StartedAt, ExpiresAt: row.ExpiresAt,
	}
	if !g.Allows(a, team, r.scope(), s.now()) {
		return nil, nil
	}
	e := a.Audit("breakglass.read", r.TargetType, r.TargetID)
	e.TeamID = team
	e.Metadata = map[string]any{"sessionId": g.ID.String(), "kind": r.Kind, "scope": r.scope()}
	if err := audit.Record(ctx, s.q, e); err != nil {
		return nil, fmt.Errorf("record break-glass read: %w", err)
	}
	observability.BreakGlassReads.WithLabelValues(r.Kind).Inc()
	return &g, nil
}

// kindLabels name the read kinds in the owners' summary: the item (what
// the distinct targets are) and whether the kind is a list.
var kindLabels = map[string]struct {
	label, unit string
	list        bool
}{
	ReadConversationList: {"Conversation list", "", true},
	ReadConversation:     {"Conversation transcripts", "conversation", false},
	ReadSourceList:       {"Data source list", "", true},
	ReadSource:           {"Data sources", "source", false},
	ReadDocumentList:     {"Document lists", "source", false},
	ReadDocument:         {"Documents", "document", false},
	ReadPassages:         {"Document passages", "document", false},
	ReadTags:             {"Document tags", "source", false},
	ReadCrawls:           {"Crawl history", "source", false},
	ReadBoilerplate:      {"Repeated blocks", "source", false},
}

// kindOrder is the summary's order.
var kindOrder = []string{
	ReadConversationList, ReadConversation, ReadSourceList, ReadSource, ReadDocumentList,
	ReadDocument, ReadPassages, ReadTags, ReadCrawls, ReadBoilerplate,
}

// SummaryLines renders a session's read counts for the owners: one line per
// kind, e.g. "- Conversation transcripts: 3 conversations (5 reads)".
func SummaryLines(counts []dbgen.BreakGlassReadCountsRow) []string {
	by := map[string]dbgen.BreakGlassReadCountsRow{}
	for _, c := range counts {
		by[c.Kind] = c
	}
	var out []string
	for _, k := range kindOrder {
		c, ok := by[k]
		if !ok || c.Reads == 0 {
			continue
		}
		l := kindLabels[k]
		if l.list {
			out = append(out, fmt.Sprintf("- %s: viewed %s", l.label, times(c.Reads)))
			continue
		}
		out = append(out, fmt.Sprintf("- %s: %s (%s)", l.label, count(c.Targets, l.unit), count(c.Reads, "read")))
	}
	return out
}

func count(n int64, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return fmt.Sprintf("%d %ss", n, unit)
}

func times(n int64) string {
	if n == 1 {
		return "once"
	}
	return fmt.Sprintf("%d times", n)
}
