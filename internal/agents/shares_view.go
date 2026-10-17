package agents

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Opening a shared conversation (docs/specs/v0.6.0/DESIGN.md §3). openShare is the only gate: the view and the cited sources both go through
// it, so they can never disagree about who may read.

var errSignInToView = apperr.New(http.StatusUnauthorized, "sign_in_required", "Sign in to open this shared conversation")

// shareAccess is a share that the caller may open.
type shareAccess struct {
	row dbgen.GetShareByTokenHashRow
	// owner: the caller is the person who made the link.
	owner bool
}

// openShare finds the share by its link's secret and decides whether the caller may read it.
//
// Anonymous callers get 401 for everything but a link open to anyone on a public agent that is still public, and that includes a secret that
// does not exist, so nobody can tell valid links from invalid ones without having one. Signed-in callers get 404 for every refusal. A link is
// closed when its agent is disabled, unpublished or deleted, when its conversation was deleted (by its user now, by retention later), or when
// the caller may not chat with the agent (its audience: the team, everyone signed in, or, for a public agent, everyone signed in while public
// access is on), and when its owner is no longer an active person who may chat with the agent (they left the team, were suspended or lost
// access): a link is the owner's, so it ends with their standing, for everybody including them, and comes back with it. While the owner is in
// good standing they may always open it, whatever the agent's audience.
func (s *Service) openShare(ctx context.Context, a authz.Actor, token string) (shareAccess, error) {
	anonymous := a.UserID == uuid.Nil || a.Delegated()
	refuse := errNoShare
	if anonymous {
		refuse = errSignInToView
	}
	hash, ok := shareTokenHash(token)
	if !ok {
		return shareAccess{}, refuse
	}
	row, err := s.q.GetShareByTokenHash(ctx, hash)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return shareAccess{}, refuse
	} else if err != nil {
		return shareAccess{}, err
	}
	if row.AgentStatus != StatusActive || !row.PublishedVersionID.Valid {
		return shareAccess{}, refuse
	}
	grant := s.grantOf(ctx, row.AgentID)
	if ok, err := s.ownerStanding(ctx, row, grant); err != nil {
		return shareAccess{}, err
	} else if !ok {
		return shareAccess{}, refuse
	}
	if anonymous {
		on, err := s.publicEnabled(ctx)
		if err != nil {
			return shareAccess{}, err
		}
		if row.Audience != ShareAnyone || grant != authz.AudiencePublic || !on {
			return shareAccess{}, refuse
		}
		return shareAccess{row: row}, nil
	}
	if a.UserID == row.CreatedBy {
		return shareAccess{row: row, owner: true}, nil
	}
	if ok, err := s.mayUse(ctx, a, row.TeamID, grant); err != nil {
		return shareAccess{}, err
	} else if !ok {
		return shareAccess{}, refuse
	}
	return shareAccess{row: row}, nil
}

// ownerStanding reports whether the person who made a link is still an active person who may chat with the agent: the condition for the link to
// work at all.
func (s *Service) ownerStanding(ctx context.Context, row dbgen.GetShareByTokenHashRow, grant string) (bool, error) {
	if row.CreatorStatus != "active" {
		return false, nil
	}
	return s.mayUse(ctx, authz.Actor{UserID: row.CreatedBy}, row.TeamID, grant)
}

// SharedCitation is a source of a shared answer: what the answer showed, without the agent's checks of it. A tool's result is named, never
// shown.
type SharedCitation struct {
	N           int      `json:"n"`
	Title       string   `json:"title"`
	Snippet     string   `json:"snippet,omitempty"`
	HeadingPath []string `json:"headingPath"`
	PageStart   *int32   `json:"pageStart,omitempty"`
	PageEnd     *int32   `json:"pageEnd,omitempty"`
	URL         string   `json:"url,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	Server      string   `json:"server,omitempty"`
	Tool        string   `json:"tool,omitempty"`
	Truncated   bool     `json:"truncated,omitempty"`
}

// SharedMessage is a question or an answer of a shared conversation: its text and citations, and nothing else. Never feedback, reasoning, the
// agent's steps, the search it ran, its checks, tokens or timings.
type SharedMessage struct {
	ID        uuid.UUID        `json:"id"`
	Seq       int32            `json:"seq"`
	Role      string           `json:"role"`
	Text      string           `json:"text"`
	Citations []SharedCitation `json:"citations"`
	ErrorCode string           `json:"errorCode,omitempty"`
	// Stopped: the answer was stopped before it finished.
	Stopped   bool      `json:"stopped,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// SharedConversation is a shared view of a conversation.
type SharedConversation struct {
	Title            string
	AgentName        string
	AgentSlug        string
	AgentDescription string
	AccentColor      string
	TeamSlug         string
	// SharedBy is the sharer's display name when they chose to show it ("": not shown).
	SharedBy string
	SharedAt time.Time
	Audience string
	// Owner: the viewer made this link.
	Owner    bool
	Messages []SharedMessage
}

func sharedCitation(c Citation) SharedCitation {
	out := SharedCitation{N: c.N, Title: c.Title, Snippet: c.Snippet, HeadingPath: c.HeadingPath, PageStart: c.PageStart, PageEnd: c.PageEnd, URL: c.URL,
		Kind: c.Kind, Server: c.Server, Tool: c.Tool, Truncated: c.Truncated}
	if out.HeadingPath == nil {
		out.HeadingPath = []string{}
	}
	if c.Kind == SourceTool {
		// A tool's result is not the team's knowledge base, so no one reads its text through a link.
		out.Snippet, out.URL = "", ""
	}
	return out
}

// sharedMessages are the snapshot's questions and answers, in order: the messages up to the last one the share covers.
func sharedMessages(views []MessageView, upToSeq int32) []SharedMessage {
	out := []SharedMessage{}
	for _, v := range views {
		if v.Seq > upToSeq || (v.Role != "user" && v.Role != "assistant") {
			continue
		}
		m := SharedMessage{ID: v.ID, Seq: v.Seq, Role: v.Role, Text: v.Text, ErrorCode: v.ErrorCode, Stopped: v.StopReason == "aborted",
			Citations: []SharedCitation{}, CreatedAt: v.CreatedAt}
		for _, c := range v.Citations {
			m.Citations = append(m.Citations, sharedCitation(c))
		}
		out = append(out, m)
	}
	return out
}

// ViewShare returns a shared conversation to a caller who may open it, and records the use of a Sensitive or Restricted agent as a chat with it
// is (the owner's own chats were recorded when they happened).
func (s *Service) ViewShare(ctx context.Context, a authz.Actor, token string) (SharedConversation, error) {
	acc, err := s.openShare(ctx, a, token)
	if err != nil {
		return SharedConversation{}, err
	}
	row := acc.row
	rows, err := s.q.ListMessages(ctx, row.ConversationID)
	if err != nil {
		return SharedConversation{}, err
	}
	if !acc.owner {
		if err := s.recordSharedUse(ctx, a, row); err != nil {
			return SharedConversation{}, err
		}
	}
	return SharedConversation{
		Title: row.Title, AgentName: row.AgentName, AgentSlug: row.AgentSlug, AgentDescription: row.AgentDescription, AccentColor: row.AccentColor,
		TeamSlug: row.TeamSlug, SharedBy: row.SharerName, SharedAt: row.CreatedAt, Audience: row.Audience, Owner: acc.owner,
		Messages: sharedMessages(messageViews(rows), row.UpToSeq),
	}, nil
}

// recordSharedUse writes the access log entry for reading a shared answer of an agent that holds Sensitive or Restricted data.
func (s *Service) recordSharedUse(ctx context.Context, a authz.Actor, row dbgen.GetShareByTokenHashRow) error {
	ver, err := s.q.GetAgentVersion(ctx, row.PublishedVersionID.UUID)
	if err != nil {
		return err
	}
	if ver.EffectiveRank < 1 {
		return nil
	}
	return s.q.InsertAccessLog(ctx, dbgen.InsertAccessLogParams{
		UserID: nullUser(a), AgentID: row.AgentID, AgentVersionID: uuid.NullUUID{UUID: ver.ID, Valid: true}, Rank: ver.EffectiveRank, Channel: "shared",
	})
}

// SharedCitedPassage is source n of an answer inside a share's snapshot, for a caller who may open the share: the same passage in its
// document's context that the source viewer shows the person who asked. A message outside the snapshot is 404. The agent's checks of the
// claim are left out, and no one opens the whole document this way.
func (s *Service) SharedCitedPassage(ctx context.Context, a authz.Actor, token string, messageID uuid.UUID, n int) (CitedPassage, error) {
	acc, err := s.openShare(ctx, a, token)
	if err != nil {
		return CitedPassage{}, err
	}
	m, err := s.q.GetSharedCitedMessage(ctx, dbgen.GetSharedCitedMessageParams{MessageID: messageID, ConversationID: acc.row.ConversationID, UpToSeq: acc.row.UpToSeq})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return CitedPassage{}, errNoCitedMessage
	} else if err != nil {
		return CitedPassage{}, err
	}
	out, _, err := s.citedPassage(ctx, dbgen.GetCitedMessageRow(m), n)
	if err != nil {
		return CitedPassage{}, err
	}
	out.Claims, out.DocumentTeam = nil, ""
	out.Citation.Verification, out.Citation.Confidence, out.Citation.Markers = "", nil, nil
	return out, nil
}
