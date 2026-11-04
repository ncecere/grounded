package ingest

import (
	"testing"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// A block's sample is reused only while its canonical document is unchanged: a sample read from an earlier
// classification's document made the source's blocks depend on the order documents arrived in.
func TestCarrySamplesOnlyFromTheSameCanonicalDocument(t *testing.T) {
	p01 := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	p12 := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	row := func(doc uuid.NullUUID, sample string) dbgen.ListBoilerplateBlocksRow {
		return dbgen.ListBoilerplateBlocksRow{CanonicalDocumentID: doc, Sample: sample}
	}

	// Same canonical document: the stored text is kept and nothing changed.
	next := classified{1: row(p01, "")}
	if changed := carrySamples(classified{1: row(p01, "Footer")}, next); changed || next[1].Sample != "Footer" {
		t.Fatalf("same document: changed=%v sample=%q, want false and the stored text", changed, next[1].Sample)
	}

	// The block moved to another document (an earlier refresh saw only some pages): the old text is dropped, so
	// addSamples reads it from the new canonical document, exactly as a source classified in one go would.
	next = classified{1: row(p01, "")}
	if changed := carrySamples(classified{1: row(p12, "Footer seen on p12")}, next); !changed || next[1].Sample != "" {
		t.Fatalf("moved block: changed=%v sample=%q, want true and no carried text", changed, next[1].Sample)
	}

	// New and removed blocks count as changes.
	if !carrySamples(classified{}, classified{2: row(p01, "")}) || !carrySamples(classified{3: row(p01, "x")}, classified{}) {
		t.Fatal("a new or removed block is a change")
	}
}
