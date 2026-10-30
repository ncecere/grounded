package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// tablesDoc is a handbook page with a long schedule table under a caption (far more than one 128-token passage), a short fees table that fits one, and
// prose around both.
func tablesDoc() []byte {
	var b strings.Builder
	b.WriteString("# Student handbook\n\n## Fall schedule\n\nCourses meet on these days.\n\n| Course | Day | Room |\n| --- | --- | --- |\n")
	for i := range 40 {
		fmt.Fprintf(&b, "| Course %d | Monday and Wednesday at %d:00 | Room %d |\n", i, 8+i%9, 100+i)
	}
	b.WriteString("\nRooms can change, so ask the registrar before the first week.\n\n## Fees\n\nTuition and fees for the year.\n\n| Item | Amount |\n| --- | --- |\n")
	for i, item := range []string{"Tuition", "Lab fee", "Library fee", "Parking permit"} {
		fmt.Fprintf(&b, "| %s | $%d |\n", item, 100*(i+1))
	}
	b.WriteString("\nFees are due at registration.\n")
	return []byte(b.String())
}

// passages returns a source's passages for a profile in order, with their heading paths: what retrieval can find.
func (env *migEnv) passages(t *testing.T, src, profile uuid.UUID) []string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT ordinal, heading_path::text, content FROM chunks WHERE source_id = $1 AND profile_id = $2 ORDER BY ordinal`, src, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ordinal int
		var path, content string
		if err := rows.Scan(&ordinal, &path, &content); err != nil {
			t.Fatal(err)
		}
		out = append(out, fmt.Sprintf("%d|%s|%s", ordinal, path, content))
	}
	return out
}

// onProfile makes an upload source on a profile and uploads the files.
func (env *migEnv) onProfile(t *testing.T, name string, profile uuid.UUID, files ...upload) apitypes.DataSource {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": name, "classification": "open", "embeddingProfileId": profile}, &src, nil)
	mustCode(t, "source "+name, code, e, 201, "")
	env.upload(t, src.Id, files...)
	return src
}

// Chunker version 3 keeps tables structured (#24): through the index preview, through a migration that applies the same settings, and through ingestion
// on a profile with the version, a page is cut into the same passages, and every passage with rows of a table has the table's caption and header above
// them, where version 1 leaves the later pieces of a long table without the caption. Nothing existing moves: the live index is untouched until a switch.
func TestChunkerVersion3KeepsTablesStructured(t *testing.T) {
	env := newMigEnv(t)
	live := env.profileByID(t, env.from.Id)
	src := env.source(t, "Handbook", upload{"schedule.md", tablesDoc()})
	kb := env.kb(t, "Handbook", src.Id)
	before := env.passages(t, src.Id, env.from.Id)

	const caption, header = "Courses meet on these days.", "| Course | Day | Room |\n| --- | --- | --- |"
	rowPassages := func(ps []string, row string) (withRows, withHeader, withCaption int) {
		for _, p := range ps {
			if strings.Contains(p, row) {
				withRows++
				if strings.Contains(p, header+"\n| Course") {
					withHeader++
				}
				if strings.Contains(p, caption+"\n\n"+header) {
					withCaption++
				}
			}
		}
		return
	}
	if rows, withHeader, withCaption := rowPassages(before, "| Course "); rows < 3 || withHeader != rows || withCaption == rows {
		t.Fatalf("version 1: %d passages with schedule rows, %d with the header, %d with the caption; want the header in all and the caption not repeated", rows, withHeader, withCaption)
	}

	// The preview: a candidate that differs from the live profile only in the version.
	m := env.preview(t, kb.Id, map[string]any{"chunkerVersion": 3})
	m = env.waitStatus(t, m.Id, statusReady)
	cand := env.profileByID(t, m.ToProfile.Id)
	if cand.ChunkerVersion != 3 || cand.ChunkSize != live.ChunkSize || cand.ChunkOverlap != live.ChunkOverlap || live.ChunkerVersion != 1 {
		t.Fatalf("candidate %+v, live %+v", cand, live)
	}
	preview := env.passages(t, src.Id, cand.Id)
	if len(preview) == 0 || int64(len(preview)) != env.vectors(t, src.Id, cand.Id) {
		t.Fatalf("%d candidate passages, %d vectors", len(preview), env.vectors(t, src.Id, cand.Id))
	}
	if got := env.passages(t, src.Id, env.from.Id); strings.Join(got, "\x00") != strings.Join(before, "\x00") {
		t.Fatal("the live index changed while the candidate was built")
	}
	rows, withHeader, withCaption := rowPassages(preview, "| Course ")
	if rows < 3 || withHeader != rows || withCaption != rows {
		t.Fatalf("version 3: %d passages with schedule rows, %d with the header, %d with the caption; want all", rows, withHeader, withCaption)
	}
	for i := range 40 {
		if n := strings.Count(strings.Join(preview, "\n"), fmt.Sprintf("| Course %d | ", i)); n != 1 {
			t.Errorf("row %d appears %d times", i, n)
		}
	}
	whole := 0
	for _, p := range preview {
		if strings.Contains(p, "| Tuition | $100 |") && strings.Contains(p, "| Parking permit | $400 |") && strings.Contains(p, "| Item | Amount |") {
			whole++
		}
	}
	if whole != 1 {
		t.Errorf("the fees table is whole in %d passages, want 1", whole)
	}

	// Ingestion on a profile with the version cuts the same passages as the preview.
	v3 := env.newProfile(t, "tables-v3", map[string]any{
		"modelId": env.from.Model.Id, "chunkSize": live.ChunkSize, "chunkOverlap": live.ChunkOverlap, "chunkerVersion": 3,
		"documentPrefix": live.DocumentPrefix, "queryPrefix": live.QueryPrefix,
	}, 201, "")
	direct := env.passages(t, env.onProfile(t, "Direct", v3.Id, upload{"schedule.md", tablesDoc()}).Id, v3.Id)
	if strings.Join(direct, "\x00") != strings.Join(preview, "\x00") {
		t.Errorf("ingestion cut %d passages, the preview %d, and they differ", len(direct), len(preview))
	}

	// A migration to that profile (the apply that does not wait for a switch) re-cuts the stored text into the same passages.
	src2 := env.source(t, "Handbook copy", upload{"schedule.md", tablesDoc()})
	kb2 := env.kb(t, "Handbook copy", src2.Id)
	m2 := env.waitStatus(t, env.start(t, kb2.Id, v3.Id, nil).Id, apitypes.ProfileMigrationStatusSwitched)
	if env.sourceProfile(t, src2.Id) != v3.Id {
		t.Fatalf("the migration did not move the source: %+v", m2)
	}
	if applied := env.passages(t, src2.Id, v3.Id); strings.Join(applied, "\x00") != strings.Join(preview, "\x00") {
		t.Errorf("the migration cut %d passages, the preview %d, and they differ", len(applied), len(preview))
	}

	// Switching the preview applies it as it was: the same passages, now what the knowledge base searches.
	env.action(t, m, "switch", 200, "")
	if got := env.passages(t, src.Id, cand.Id); strings.Join(got, "\x00") != strings.Join(preview, "\x00") {
		t.Error("the passages changed at the switch")
	}
	found := false
	for _, h := range env.retrieve(t, kb.Id, "Course 17 Monday Wednesday Room") {
		if strings.Contains(h.Content, "| Course 17 | ") {
			found = true
			if !strings.Contains(h.Content, header) || !strings.Contains(h.Content, caption) {
				t.Errorf("a retrieved table passage lacks its caption or header: %q", h.Content)
			}
		}
	}
	if !found {
		t.Error("retrieval did not return the passage with the row")
	}
}
