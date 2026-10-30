// Parent/child retrieval (docs/parent-child-retrieval.md, ADR-0026): search ranks small passages (children); an agent's model is given the
// larger section (parent) around each. This file collapses siblings during a search and builds a parent's text afterwards. It reads nothing
// but rows of the hit's own document, source and profile, so expansion can never reach more than the search could.

package kbs

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Parent is the section around a ranked passage, for a profile with parents. A search sets ProfileID, First, Last, MaxTokens and Matched;
// ExpandParents sets the rest, or Skipped when it could not.
type Parent struct {
	ProfileID uuid.UUID
	// First and Last are the ordinals of the parent's first and last passage in the hit's document.
	First, Last int32
	// MaxTokens is the profile's parent size: a parent whose passages add up to more is not used.
	MaxTokens int32
	// Matched is how many of the search's candidate passages fell in this parent (the hit stands for all of them).
	Matched int

	// Text is the parent's text: its passages without the repetition between them (chunk.ParentText). SHA256 is its hash (hex), Tokens the
	// passages' token counts added up, PageStart and PageEnd the pages it spans (0 without pages), Passages the number of passages.
	Text               string
	SHA256             string
	Tokens, Passages   int
	PageStart, PageEnd int32
	Skipped            SkipReason
	Expanded           bool // the caller gave the model Text instead of the passage (set by the agent pipeline)
	hitOrdinal         int32
}

// SkipReason says why a parent was not used: the model is given the passage instead.
type SkipReason string

const (
	SkipNone       SkipReason = ""
	SkipSingle     SkipReason = "single"     // the parent is the passage itself
	SkipIncomplete SkipReason = "incomplete" // rows of the range are missing, repeated or out of order, or the document is not ready
	SkipStale      SkipReason = "stale"      // the rows disagree about the range: the document was cut again since the search
	SkipTooLarge   SkipReason = "too_large"  // the passages add up to more than the parent size
	SkipEmpty      SkipReason = "empty"
)

// ParentKey identifies a parent across hits, searches and knowledge bases.
type ParentKey struct {
	Profile, Document uuid.UUID
	First             int32
}

// Key is the parent's identity for a hit in a document.
func (p *Parent) Key(document uuid.UUID) ParentKey {
	return ParentKey{Profile: p.ProfileID, Document: document, First: p.First}
}

// collapseParents keeps the best-ranked hit of each parent (ranked is best first), counting the others in its Matched, then the best k. Hits
// without a parent (a passage the profile gave none, or in a profile without parents) stay as they are.
func (s *Service) collapseParents(ctx context.Context, profileID uuid.UUID, maxTokens int32, sourceIDs []uuid.UUID, ranked []*Hit, k int) ([]*Hit, error) {
	ids := make([]uuid.UUID, len(ranked))
	for i, h := range ranked {
		ids[i] = h.ChunkID
	}
	rows, err := s.q.ChunkParentRefs(ctx, dbgen.ChunkParentRefsParams{Ids: ids, ProfileID: profileID, SourceIds: sourceIDs})
	if err != nil {
		return nil, err
	}
	refs := make(map[uuid.UUID]dbgen.ChunkParentRefsRow, len(rows))
	for _, r := range rows {
		refs[r.ID] = r
	}
	seen := map[ParentKey]*Hit{}
	out := make([]*Hit, 0, min(len(ranked), k))
	for _, h := range ranked {
		r, ok := refs[h.ChunkID]
		if !ok || r.ParentFirst == nil || r.ParentLast == nil {
			out = append(out, h)
			continue
		}
		key := ParentKey{Profile: profileID, Document: r.DocumentID, First: *r.ParentFirst}
		if first := seen[key]; first != nil {
			first.Parent.Matched++
			continue
		}
		h.Parent = &Parent{ProfileID: profileID, First: *r.ParentFirst, Last: *r.ParentLast, MaxTokens: maxTokens, Matched: 1, hitOrdinal: r.Ordinal}
		seen[key] = h
		out = append(out, h)
	}
	return out[:min(len(out), k)], nil
}

// ExpandParents builds the text of each hit's parent (hits from a search of kb that collapsed parents), at most one query for all of them. A
// hit whose parent cannot be used keeps no Text and gets the reason in Skipped; the caller then gives the model the passage, as without parents.
// It reads only rows of the hit's own document, source and profile, and only for sources the search may read (kb's, narrowed by filter), while
// the document is ready. It writes nothing and checks no permission: the caller holds the grant (an agent).
func (s *Service) ExpandParents(ctx context.Context, kb KB, filter MetadataFilter, hits []*Hit) error {
	var ids []uuid.UUID
	byID := map[uuid.UUID]*Hit{}
	for _, h := range hits {
		p := h.Parent
		if p == nil || p.ProfileID != kb.EmbeddingProfileID || p.Text != "" || p.Skipped != SkipNone {
			continue
		}
		if p.First >= p.Last {
			p.Skipped = SkipSingle
			continue
		}
		ids = append(ids, h.ChunkID)
		byID[h.ChunkID] = h
	}
	sourceIDs := searchSources(kb, filter)
	if len(ids) == 0 || len(sourceIDs) == 0 {
		for _, h := range byID {
			h.Parent.Skipped = SkipIncomplete
		}
		return nil
	}
	rows, err := s.q.LoadParentPassages(ctx, dbgen.LoadParentPassagesParams{HitIds: ids, ProfileID: kb.EmbeddingProfileID, SourceIds: sourceIDs})
	if err != nil {
		return err
	}
	group := map[uuid.UUID][]dbgen.LoadParentPassagesRow{}
	for _, r := range rows {
		group[r.HitID] = append(group[r.HitID], r)
	}
	for id, h := range byID {
		fillParent(h, group[id])
	}
	return nil
}

// fillParent checks that rows are the whole parent of h, exactly as the search saw it, and sets its text.
func fillParent(h *Hit, rows []dbgen.LoadParentPassagesRow) {
	p := h.Parent
	want := int(p.Last-p.First) + 1
	if len(rows) != want || want > chunk.MaxParentChildren {
		p.Skipped = SkipIncomplete
		return
	}
	contents := make([]string, len(rows))
	tokens := 0
	var start, end int32
	holdsHit := false
	for i, r := range rows {
		if r.Ordinal != p.First+int32(i) || r.HitID != h.ChunkID {
			p.Skipped = SkipIncomplete
			return
		}
		if !sameRange(r.ParentFirst, r.ParentLast, p) || !sameRange(r.HitFirst, r.HitLast, p) || r.HitOrdinal != p.hitOrdinal {
			p.Skipped = SkipStale
			return
		}
		holdsHit = holdsHit || r.ID == h.ChunkID
		contents[i] = r.Content
		tokens += int(r.TokenCount)
		if r.PageStart > 0 && (start == 0 || r.PageStart < start) {
			start = r.PageStart
		}
		end = max(end, r.PageEnd)
	}
	switch {
	case !holdsHit:
		p.Skipped = SkipStale
	case tokens > int(p.MaxTokens) || tokens > chunk.MaxParentTokens:
		p.Skipped = SkipTooLarge
	default:
		text := chunk.ParentText(contents)
		if text == "" {
			p.Skipped = SkipEmpty
			return
		}
		p.Text, p.SHA256, p.Tokens, p.Passages, p.PageStart, p.PageEnd = text, chunk.TextHash(text), tokens, want, start, end
	}
}

func sameRange(first, last *int32, p *Parent) bool {
	return first != nil && last != nil && *first == p.First && *last == p.Last
}

// String describes a parent for logs and test failures.
func (p *Parent) String() string {
	return fmt.Sprintf("parent %d-%d (%d passages, matched %d, skipped %q)", p.First, p.Last, p.Passages, p.Matched, p.Skipped)
}
