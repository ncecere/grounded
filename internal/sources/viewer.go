// The source viewer (docs/v0.4.0.md §5): a cited passage in its document's
// context for anyone who may read the answer (internal/agents decides who),
// and a document's whole text for its team's editors, admins and owners.

package sources

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ContextPassage is a passage shown in the viewer: its content without the
// text it repeats from the passage before it (chunk overlap), except the
// cited one, which is always whole.
type ContextPassage struct {
	ID          uuid.UUID
	Ordinal     int32
	Content     string
	HeadingPath []string
	PageStart   int32
	PageEnd     int32
	Cited       bool
}

// Context sizes: "about a page" is the cited passage plus neighbours on each
// side until about contextChars characters, at most contextMax of them (at
// least one when there is one: a tiny heading passage alone says little).
const (
	contextChars = 1200
	contextMax   = 3
	// matchBatch and matchMax bound the search for a passage by its text
	// (citations without a passage ID, or whose passage was re-cut).
	matchBatch = 500
	matchMax   = 5000
)

// ErrPassageNotFound: the document no longer has the passage.
var ErrPassageNotFound = apperr.NotFound("passage_not_found", "This passage is no longer in the document")

// PassageQuery finds the cited passage: by ID while it is one of the
// document's current passages, else the first passage whose content Match
// accepts (nil Match: by ID only).
type PassageQuery struct {
	ChunkID uuid.UUID
	Match   func(content string) bool
}

// PassageInContext returns the passage with its neighbours (about a page),
// in order; ErrPassageNotFound when the document no longer has it. It does
// no authorization: callers decide who may see a cited passage.
func PassageInContext(ctx context.Context, q *dbgen.Queries, doc dbgen.GetViewerDocumentRow, pq PassageQuery) ([]ContextPassage, error) {
	ordinal, err := findPassage(ctx, q, doc, pq)
	if err != nil {
		return nil, err
	}
	rows, err := q.ListViewerChunks(ctx, dbgen.ListViewerChunksParams{DocumentID: doc.ID, FromOrdinal: ordinal - contextMax, ToOrdinal: ordinal + contextMax})
	if err != nil {
		return nil, err
	}
	at := -1
	for i, r := range rows {
		if r.Ordinal == ordinal {
			at = i
		}
	}
	if at < 0 {
		return nil, ErrPassageNotFound // re-cut between the two reads
	}
	first, last := at, at
	for n, chars := 0, 0; first > 0 && n < contextMax && (n == 0 || chars < contextChars); n++ {
		first--
		chars += utf8.RuneCountInString(rows[first].Content)
	}
	for n, chars := 0, 0; last < len(rows)-1 && n < contextMax && (n == 0 || chars < contextChars); n++ {
		last++
		chars += utf8.RuneCountInString(rows[last].Content)
	}
	out := toContext(rows[first:last+1], ordinal)
	return trimOverlaps(out), nil
}

// findPassage is the cited passage's ordinal.
func findPassage(ctx context.Context, q *dbgen.Queries, doc dbgen.GetViewerDocumentRow, pq PassageQuery) (int32, error) {
	if pq.ChunkID != uuid.Nil {
		o, err := q.GetViewerChunk(ctx, dbgen.GetViewerChunkParams{ID: pq.ChunkID, DocumentID: doc.ID})
		if err == nil {
			return o, nil
		}
		if !errors.Is(store.NotFound(err), store.ErrNotFound) {
			return 0, err
		}
	}
	if pq.Match == nil {
		return 0, ErrPassageNotFound
	}
	for from := int32(0); from < matchMax && from < max(doc.ChunkCount, 1); from += matchBatch {
		rows, err := q.ListViewerChunks(ctx, dbgen.ListViewerChunksParams{DocumentID: doc.ID, FromOrdinal: from, ToOrdinal: from + matchBatch - 1})
		if err != nil {
			return 0, err
		}
		for _, r := range rows {
			if pq.Match(r.Content) {
				return r.Ordinal, nil
			}
		}
	}
	return 0, ErrPassageNotFound
}

func toContext(rows []dbgen.ListViewerChunksRow, cited int32) []ContextPassage {
	out := make([]ContextPassage, len(rows))
	for i, r := range rows {
		hp := r.HeadingPath
		if hp == nil {
			hp = []string{}
		}
		out[i] = ContextPassage{ID: r.ID, Ordinal: r.Ordinal, Content: r.Content, HeadingPath: hp, PageStart: r.PageStart, PageEnd: r.PageEnd,
			Cited: r.Ordinal == cited}
	}
	return out
}

// minOverlap is the shortest repeated text treated as chunk overlap (shorter
// matches are coincidences, like a repeated word).
const minOverlap = 24

// trimOverlaps removes the text each passage repeats from the one before it
// (the chunker carries trailing context over within a section), so the
// viewer reads like the document. The cited passage stays whole: the
// passage before it loses the repeated tail instead.
func trimOverlaps(ps []ContextPassage) []ContextPassage {
	for i := 1; i < len(ps); i++ {
		prev, next := &ps[i-1], &ps[i]
		if prev.Ordinal+1 != next.Ordinal {
			continue
		}
		n := overlap(prev.Content, next.Content)
		if n == 0 {
			continue
		}
		if next.Cited {
			prev.Content = strings.TrimRight(prev.Content[:len(prev.Content)-n], " \t\n")
		} else {
			next.Content = strings.TrimLeft(next.Content[n:], " \t\n")
		}
	}
	return ps
}

// overlap is the length in bytes of the longest suffix of a that is a prefix
// of b (at least minOverlap bytes, and not the whole of b), or 0.
func overlap(a, b string) int {
	if len(b) < minOverlap || len(a) < minOverlap {
		return 0
	}
	head := b[:minOverlap]
	best := 0
	for i := strings.Index(a, head); i >= 0; {
		if n := len(a) - i; n < len(b) && strings.HasPrefix(b, a[i:]) {
			best = n
			break // the earliest start is the longest overlap
		}
		j := strings.Index(a[i+1:], head)
		if j < 0 {
			break
		}
		i += j + 1
	}
	return best
}

// DocumentTextQuery selects a document's passages: Around (a passage ID)
// for the passage in context, else Limit passages from ordinal From.
type DocumentTextQuery struct {
	From, Limit int32
	Around      *uuid.UUID
}

// DocumentText is a document's text as passages.
type DocumentText struct {
	Document dbgen.GetViewerDocumentRow
	Items    []ContextPassage
}

// DocumentText returns a document's passages for the viewer's "Open full
// document": the team's editors, admins and owners (and a platform admin
// under a break-glass session with the documents scope, as for passages);
// members see only the passages their answers cited (403).
func (s *Service) DocumentText(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, tq DocumentTextQuery) (DocumentText, error) {
	sc, err := s.readAccess(ctx, a, o, breakglass.Read{Kind: breakglass.ReadPassages, TargetType: "document", TargetID: docID.String()})
	if err != nil {
		return DocumentText{}, err
	}
	if sc.team != nil && sc.role != "" && !authz.RoleAtLeast(sc.role, authz.RoleEditor) {
		return DocumentText{}, apperr.Forbidden("Only team editors, admins and owners can open whole documents")
	}
	if _, _, _, err := s.lookupDocument(ctx, sc, sourceID, docID); err != nil {
		return DocumentText{}, err
	}
	doc, err := s.q.GetViewerDocument(ctx, docID)
	if err != nil {
		return DocumentText{}, store.NotFound(err)
	}
	out := DocumentText{Document: doc}
	if tq.Around != nil {
		out.Items, err = PassageInContext(ctx, s.q, doc, PassageQuery{ChunkID: *tq.Around})
		return out, err
	}
	rows, err := s.q.ListViewerChunks(ctx, dbgen.ListViewerChunksParams{DocumentID: docID, FromOrdinal: tq.From, ToOrdinal: tq.From + tq.Limit - 1})
	if err != nil {
		return out, err
	}
	out.Items = trimOverlaps(toContext(rows, -1))
	return out, nil
}
