package kbs

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// parentRows are the rows LoadParentPassages returns for a hit in the parent first..last of passages of 20 tokens each.
func parentRows(hit uuid.UUID, hitOrdinal, first, last int32) []dbgen.LoadParentPassagesRow {
	var rows []dbgen.LoadParentPassagesRow
	for o := first; o <= last; o++ {
		id := uuid.New()
		if o == hitOrdinal {
			id = hit
		}
		rows = append(rows, dbgen.LoadParentPassagesRow{HitID: hit, HitOrdinal: hitOrdinal, HitFirst: &first, HitLast: &last, ID: id, Ordinal: o,
			Content: fmt.Sprintf("Passage %d says something different about section matters.", o), TokenCount: 20, PageStart: o, PageEnd: o + 1,
			ParentFirst: &first, ParentLast: &last})
	}
	return rows
}

func parentHitAt(first, last, ordinal int32, maxTokens int32) *Hit {
	h := &Hit{ChunkID: uuid.New(), Content: "the passage"}
	h.Parent = &Parent{First: first, Last: last, MaxTokens: maxTokens, Matched: 1, hitOrdinal: ordinal}
	return h
}

func TestFillParentBuildsTheTextFromWholeRange(t *testing.T) {
	h := parentHitAt(3, 6, 4, 100)
	rows := parentRows(h.ChunkID, 4, 3, 6)
	fillParent(h, rows)
	p := h.Parent
	if p.Skipped != SkipNone || p.Passages != 4 || p.Tokens != 80 || p.PageStart != 3 || p.PageEnd != 7 {
		t.Fatalf("parent = %v %+v", p, p)
	}
	contents := make([]string, len(rows))
	for i, r := range rows {
		contents[i] = r.Content
	}
	if p.Text != chunk.ParentText(contents) || p.SHA256 != chunk.TextHash(p.Text) || !strings.Contains(p.Text, "Passage 6") {
		t.Errorf("text = %q", p.Text)
	}
}

// A parent that cannot be used whole, exactly as the search saw it, is not used at all: no text, and a reason (§5).
func TestFillParentRefusesWhatItCannotTrust(t *testing.T) {
	for name, tc := range map[string]struct {
		mutate func(rows []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow
		max    int32
		want   SkipReason
	}{
		"a row of the range is missing": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			return append(r[:1:1], r[2:]...)
		}, 100, SkipIncomplete},
		"no rows":                 {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow { return nil }, 100, SkipIncomplete},
		"the last row is missing": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow { return r[:len(r)-1] }, 100, SkipIncomplete},
		"a row is repeated": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			return append(r[:2:2], append([]dbgen.LoadParentPassagesRow{r[1]}, r[3:]...)...)
		}, 100, SkipIncomplete},
		"rows out of order": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			r[0], r[1] = r[1], r[0]
			return r
		}, 100, SkipIncomplete},
		"a sibling records another range (the document was cut again)": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			other := int32(9)
			r[2].ParentLast = &other
			return r
		}, 100, SkipStale},
		"a sibling has no range": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			r[1].ParentFirst = nil
			return r
		}, 100, SkipStale},
		"the hit now records another range": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			other := int32(8)
			for i := range r {
				r[i].HitLast = &other
			}
			return r
		}, 100, SkipStale},
		"the hit moved to another ordinal": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			for i := range r {
				r[i].HitOrdinal = 5
			}
			return r
		}, 100, SkipStale},
		"the passages add up to more than the parent size": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow { return r }, 79, SkipTooLarge},
		"the hit is not among the rows": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			r[1].ID = uuid.New()
			return r
		}, 100, SkipStale},
		"the text is empty": {func(r []dbgen.LoadParentPassagesRow) []dbgen.LoadParentPassagesRow {
			for i := range r {
				r[i].Content = " \n"
			}
			return r
		}, 100, SkipEmpty},
	} {
		t.Run(name, func(t *testing.T) {
			h := parentHitAt(3, 6, 4, tc.max)
			fillParent(h, tc.mutate(parentRows(h.ChunkID, 4, 3, 6)))
			if h.Parent.Skipped != tc.want || h.Parent.Text != "" || h.Parent.SHA256 != "" {
				t.Errorf("parent = %v, text %q", h.Parent, h.Parent.Text)
			}
		})
	}
}

// The parent size is capped whatever a row says, and a range wider than a parent can be is refused before any text is built.
func TestFillParentHardBounds(t *testing.T) {
	h := parentHitAt(0, chunk.MaxParentChildren, 1, 8192) // 65 passages
	fillParent(h, parentRows(h.ChunkID, 1, 0, chunk.MaxParentChildren))
	if h.Parent.Skipped != SkipIncomplete || h.Parent.Text != "" {
		t.Errorf("65 passages: %v", h.Parent)
	}
	h = parentHitAt(0, 2, 1, 1<<20) // a size above the cap, passages that add up to more than 8192 tokens
	rows := parentRows(h.ChunkID, 1, 0, 2)
	for i := range rows {
		rows[i].TokenCount = 4000
	}
	fillParent(h, rows)
	if h.Parent.Skipped != SkipTooLarge {
		t.Errorf("12000 tokens under a size of 1<<20: %v", h.Parent)
	}
}
