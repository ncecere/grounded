package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The fixture of the near-duplicate boilerplate tests (#23): twelve upload documents of one source, each with
//   - a unique paragraph (never boilerplate),
//   - an exact repeat on every page (the existing hash matching finds it),
//   - a navigation menu whose highlighted item differs per page (bold on some, "(current page)" on others): twelve
//     different exact hashes, none of them frequent enough on its own,
//   - a footer whose date changes per page (a month name, so exact hashing does not fold it),
//   - a negative control: a paragraph that shares many words with the same paragraph of the other pages but says
//     something different.
const fuzzyDocs = 12

var (
	fuzzyMenuItems = []string{"Home", "Admissions", "Academics", "Registrar", "Student life", "Contact us"}
	fuzzyMonths    = []string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}
	// Pairs of sentences over the same vocabulary that are not the same text.
	fuzzyControls = []string{
		"Students may petition the dean to drop a course after the published deadline when a documented emergency prevented earlier action.",
		"After the published deadline a documented emergency allows the dean to drop a course when students petition and earlier action was prevented.",
		"Transcripts are mailed within three business days when the student requests an official copy and the account carries no hold.",
		"A hold on the account prevents the registrar from mailing official copies even when the student requests a transcript within three days.",
	}
)

// fuzzyMenu is the menu of page i: item i%6 is highlighted, in bold or with a marker.
func fuzzyMenu(i int) string {
	var b strings.Builder
	for j, item := range fuzzyMenuItems {
		link := fmt.Sprintf("[%s](/%s)", item, strings.ToLower(strings.ReplaceAll(item, " ", "-")))
		if j == i%len(fuzzyMenuItems) {
			if i/len(fuzzyMenuItems)%2 == 0 {
				link = fmt.Sprintf("[**%s**](/%s)", item, strings.ToLower(strings.ReplaceAll(item, " ", "-")))
			} else {
				link += " (current page)"
			}
		}
		b.WriteString("- " + link + "\n")
	}
	return b.String()
}

func fuzzyDoc(i int) upload {
	body := fmt.Sprintf("# Policy %c\n\n%s\n\n%s\n\n%s\n\nLast updated %s %d, 2026 by the Office of the Test Registrar, 101 Main Hall, 555-0100.\n\n%s\n\nZebraSignoff: the Office of the Test Registrar answers every request within two business days.\n",
		'A'+i, bpTopics[i%len(bpTopics)]+fmt.Sprintf(" This is policy %c of the handbook and applies to every student.", 'A'+i),
		fuzzyMenu(i), fuzzyControls[i%len(fuzzyControls)], fuzzyMonths[i], i+3,
		"Appendix "+string(rune('A'+i))+" lists the forms for "+[]string{"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"}[i]+" requests.")
	return upload{fmt.Sprintf("p%02d.md", i+1), []byte(body)}
}

func fuzzyFiles() []upload {
	out := make([]upload, fuzzyDocs)
	for i := range out {
		out[i] = fuzzyDoc(i)
	}
	return out
}

// blockSnapshot is everything the matching decides for a source, by document name (never by id, so it is stable).
type blockSnapshot struct {
	Summary struct {
		RepeatedBlocks, PagesAffected int64
		Documents, Threshold          int32
	}
	Blocks    []snapshotBlock
	Documents map[string]snapshotDocument
}

type snapshotBlock struct {
	Hash      int64
	Documents int32
	Sample    string
	Canonical string
}

type snapshotDocument struct {
	Hashes, Dropped []int64
	Chunks          []string
}

// snapshotBlocks reads a source's classification, each document's recorded and dropped hashes, and its chunks.
func snapshotBlocks(t *testing.T, env *ragEnv, src apitypes.DataSource, bp apitypes.SourceBoilerplate) blockSnapshot {
	t.Helper()
	ctx := context.Background()
	var s blockSnapshot
	s.Summary.RepeatedBlocks, s.Summary.PagesAffected, s.Summary.Documents, s.Summary.Threshold = bp.RepeatedBlocks, bp.PagesAffected, bp.DocumentsCounted, bp.Threshold
	rows, err := env.app.Pool.Query(ctx, `SELECT b.block_hash, b.doc_count, b.sample, coalesce(d.filename, '') FROM source_boilerplate_blocks b
		LEFT JOIN documents d ON d.id = b.canonical_document_id WHERE b.source_id = $1 ORDER BY b.block_hash`, src.Id)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var b snapshotBlock
		if err := rows.Scan(&b.Hash, &b.Documents, &b.Sample, &b.Canonical); err != nil {
			t.Fatal(err)
		}
		s.Blocks = append(s.Blocks, b)
	}
	rows.Close()
	s.Documents = map[string]snapshotDocument{}
	rows, err = env.app.Pool.Query(ctx, `SELECT d.filename, db.hashes, db.dropped FROM document_blocks db JOIN documents d ON d.id = db.document_id WHERE db.source_id = $1`, src.Id)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		var d snapshotDocument
		if err := rows.Scan(&name, &d.Hashes, &d.Dropped); err != nil {
			t.Fatal(err)
		}
		sort.Slice(d.Dropped, func(i, j int) bool { return d.Dropped[i] < d.Dropped[j] })
		s.Documents[name] = d
	}
	rows.Close()
	rows, err = env.app.Pool.Query(ctx, `SELECT d.filename, c.content FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.source_id = $1 ORDER BY d.filename, c.ordinal`, src.Id)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name, content string
		if err := rows.Scan(&name, &content); err != nil {
			t.Fatal(err)
		}
		d := s.Documents[name]
		d.Chunks = append(d.Chunks, content)
		s.Documents[name] = d
	}
	rows.Close()
	return s
}

// checkGolden compares a snapshot with a file under testdata; UPDATE_GOLDEN=1 rewrites it.
func checkGolden(t *testing.T, file string, got blockSnapshot) {
	t.Helper()
	data, err := json.MarshalIndent(got, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := "testdata/" + file
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != string(data) {
		t.Errorf("%s differs from what the matching decided:\n--- want\n%s\n--- got\n%s", path, want, data)
	}
}
