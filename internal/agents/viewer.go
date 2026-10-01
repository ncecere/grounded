package agents

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The source viewer (docs/v0.4.0.md §5): a passage an answer cited, in its
// document's context, for whoever may read the answer: the conversation's
// user, or the anonymous session that asked (ADR-0010). Only the passages
// the answer cited are served (by their [n]), so nobody can page through a
// knowledge base by its answers; the document's team editors, admins and
// owners may also open the whole document (sources.DocumentText).

// Cited passage statuses.
const (
	PassageAvailable       = "available"
	PassageDocumentDeleted = "document_deleted"
	PassageChanged         = "passage_changed"
)

// CitedPassage is a cited passage in context.
type CitedPassage struct {
	Status      string
	Citation    Citation
	HeadingPath []string
	Passages    []sources.ContextPassage
	// Claims are the answer's claims that cite this source, with their text.
	Claims []Claim
	// DocumentTeam is the source's team slug when the caller may open the
	// whole document ("" otherwise).
	DocumentTeam string
}

var (
	errNoCitedMessage = apperr.NotFound("message_not_found", "Message not found")
	errNoCitedSource  = apperr.NotFound("source_not_found", "This answer cites no passage with that number")
)

// CitedPassage is source n of an answer in one of the actor's conversations.
func (s *Service) CitedPassage(ctx context.Context, a authz.Actor, messageID uuid.UUID, n int) (CitedPassage, error) {
	if err := ownerOnly(a); err != nil {
		return CitedPassage{}, errNoCitedMessage
	}
	m, err := s.q.GetCitedMessage(ctx, messageID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && !ownedBy(m.UserID, a.UserID)) {
		return CitedPassage{}, errNoCitedMessage
	} else if err != nil {
		return CitedPassage{}, err
	}
	if ok, err := s.keyReaches(ctx, a, m.AgentID); err != nil || !ok {
		return CitedPassage{}, notFoundAs(err, errNoCitedMessage)
	}
	out, doc, err := s.citedPassage(ctx, m, n)
	if err != nil || !doc.TeamID.Valid {
		return out, err
	}
	// Whole documents: the source's team editors, admins and owners, who see
	// it in Data sources anyway (an API key by its scope-derived role).
	if acc, err := s.Teams.Get(ctx, a, doc.TeamID.UUID.String()); err == nil && authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		out.DocumentTeam = doc.TeamSlug
	}
	return out, nil
}

// PublicCitedPassage is source n of an answer in a conversation of an
// anonymous session with the agent; 404 for any other conversation.
func (s *Service) PublicCitedPassage(ctx context.Context, sessionID, agentID, messageID uuid.UUID, n int) (CitedPassage, error) {
	m, err := s.q.GetCitedMessage(ctx, messageID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) ||
		(err == nil && (!m.AnonSessionID.Valid || m.AnonSessionID.UUID != sessionID || m.AgentID != agentID)) {
		return CitedPassage{}, errNoCitedMessage
	} else if err != nil {
		return CitedPassage{}, err
	}
	out, _, err := s.citedPassage(ctx, m, n)
	return out, err
}

// citedPassage loads source n of an answer the caller may read.
func (s *Service) citedPassage(ctx context.Context, m dbgen.GetCitedMessageRow, n int) (CitedPassage, dbgen.GetViewerDocumentRow, error) {
	var doc dbgen.GetViewerDocumentRow
	if m.Role != "assistant" {
		return CitedPassage{}, doc, errNoCitedMessage
	}
	var cites []Citation
	if len(m.Citations) > 0 {
		if err := json.Unmarshal(m.Citations, &cites); err != nil {
			return CitedPassage{}, doc, err
		}
	}
	var c *Citation
	for i := range cites {
		if cites[i].N == n && cites[i].Kind != SourceTool {
			c = &cites[i]
		}
	}
	if c == nil {
		return CitedPassage{}, doc, errNoCitedSource
	}
	out := CitedPassage{Status: PassageAvailable, Citation: *c, HeadingPath: c.HeadingPath, Claims: claimsCiting(m, n),
		Passages: []sources.ContextPassage{}}
	doc, err := s.q.GetViewerDocument(ctx, c.DocumentID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && doc.SourceID != c.SourceID) {
		out.Status = PassageDocumentDeleted
		return out, dbgen.GetViewerDocumentRow{}, nil
	} else if err != nil {
		return out, doc, err
	}
	pq := sources.PassageQuery{Match: func(content string) bool { return snippet(content) == c.Snippet }}
	if c.ChunkID != nil {
		pq.ChunkID = *c.ChunkID
	}
	ps, err := sources.PassageInContext(ctx, s.q, doc, pq)
	if errors.Is(err, sources.ErrPassageNotFound) {
		out.Status = PassageChanged
		return out, doc, nil
	} else if err != nil {
		return out, doc, err
	}
	out.Passages = ps
	for _, p := range ps {
		if p.Cited {
			out.HeadingPath = p.HeadingPath
		}
	}
	return out, doc, nil
}

// claimsCiting is the answer's claims that cite source n, with their text
// (none when its citations weren't checked per claim).
func claimsCiting(m dbgen.GetCitedMessageRow, n int) []Claim {
	out := []Claim{}
	if len(m.CitationCheck) == 0 || m.AnswerRefused || m.ErrorCode != "" {
		return out
	}
	var rec CitationsRecord
	if json.Unmarshal(m.CitationCheck, &rec) != nil {
		return out
	}
	for _, c := range FillClaimText(answerText(m.Content), rec.ClaimList) {
		for _, k := range c.Checks {
			if k.N == n {
				out = append(out, c)
				break
			}
		}
	}
	return out
}

// answerText is the text of a stored answer's content blocks.
func answerText(content json.RawMessage) string {
	blocks, _ := llm.UnmarshalBlocks(content)
	text := ""
	for _, b := range blocks {
		if t, ok := b.(llm.Text); ok {
			text += t.Text
		}
	}
	return text
}
