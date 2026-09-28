package evals

import (
	"bytes"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestParseCSV(t *testing.T) {
	id := uuid.New()
	content := "\ufeffquestion,expected,must_mention,note\n" +
		"How do I order a transcript?,https://example.edu/registrar/transcripts*,fee | Registrar,from the FAQ\n" +
		"\n" +
		"Where is the handbook?," + id.String() + " | handbook.pdf\n" +
		"No expected document,,\n" +
		",https://example.edu/\n" +
		"Bad URL,https://example.edu/a*b\n" +
		"\"Quoted, with a comma\",https://example.edu/q\n" +
		"'=SUM(A1),https://example.edu/formula\n"
	rows, probs := ParseCSV(content)
	if len(rows) != 4 {
		t.Fatalf("rows = %+v, problems %+v", rows, probs)
	}
	if r := rows[0]; r.Line != 2 || r.Question != "How do I order a transcript?" || r.Expected.URLs[0] != "https://example.edu/registrar/transcripts*" ||
		strings.Join(r.MustMention, ",") != "fee,Registrar" || r.Note != "from the FAQ" {
		t.Errorf("row 1 = %+v", r)
	}
	if r := rows[1]; r.Line != 4 || len(r.Expected.DocumentIDs) != 1 || r.Expected.DocumentIDs[0] != id || r.Expected.Filenames[0] != "handbook.pdf" {
		t.Errorf("row 2 = %+v", r)
	}
	if rows[2].Question != "Quoted, with a comma" || rows[3].Question != "=SUM(A1)" {
		t.Errorf("quoted and formula rows = %+v %+v", rows[2], rows[3])
	}
	lines := []int{}
	for _, p := range probs {
		lines = append(lines, p.Line)
	}
	if len(probs) != 3 || lines[0] != 5 || lines[1] != 6 || lines[2] != 7 {
		t.Errorf("problems = %+v", probs)
	}
	if !strings.Contains(probs[0].Message, "expected document") || !strings.Contains(probs[1].Message, "question") {
		t.Errorf("problem messages = %+v", probs)
	}
}

func TestParseCSVBroken(t *testing.T) {
	rows, probs := ParseCSV("q1,https://example.edu/a\n\"unterminated,https://example.edu/b\n")
	if len(rows) != 1 || len(probs) != 1 || !strings.Contains(probs[0].Message, "isn't valid CSV") {
		t.Errorf("rows %+v problems %+v", rows, probs)
	}
}

func TestParseJSONL(t *testing.T) {
	content := `{"id":"q1","question":"When does registration open?","urls":["https://example.edu/registrar/calendar/"]}

{"id":"q2","question":"","urls":["https://example.edu/x"]}
not json
{"id":"q4","question":"No URLs","urls":[]}
{"id":"q5","question":"Two pages","urls":["https://example.edu/a","https://example.edu/b"]}
`
	rows, probs := ParseJSONL(content)
	if len(rows) != 2 || rows[0].Line != 1 || rows[1].Line != 6 || len(rows[1].Expected.URLs) != 2 {
		t.Fatalf("rows = %+v", rows)
	}
	if len(probs) != 3 || probs[0].Line != 3 || probs[1].Line != 4 || probs[2].Line != 5 {
		t.Errorf("problems = %+v", probs)
	}
}

func TestParseLimits(t *testing.T) {
	if _, _, err := Parse("xml", "x"); err == nil {
		t.Error("unknown format accepted")
	}
	if _, _, err := Parse(FormatCSV, strings.Repeat("x", MaxImportBytes+1)); err == nil {
		t.Error("an oversized import was accepted")
	}
	if _, _, err := Parse(FormatJSONL, strings.Repeat(`{"question":"q","urls":["https://example.edu/"]}`+"\n", MaxImportRows+1)); err == nil {
		t.Error("too many rows were accepted")
	}
}

func TestDedupe(t *testing.T) {
	rows := []ImportRow{{Line: 1, CaseInput: CaseInput{Question: "Where is the  office?"}}, {Line: 2, CaseInput: CaseInput{Question: "where is the office?"}},
		{Line: 3, CaseInput: CaseInput{Question: "Parking?"}}}
	out, probs := Dedupe(rows, []string{"parking?"})
	if len(out) != 1 || out[0].Line != 1 || len(probs) != 2 {
		t.Errorf("out %+v problems %+v", out, probs)
	}
}

func TestExportRoundTrip(t *testing.T) {
	id := uuid.New()
	in := []ExportRow{
		{Question: "How, exactly?", Expected: Expected{DocumentIDs: []uuid.UUID{id}, URLs: []string{"https://example.edu/a*"}}, MustMention: []string{"fee", "form"}, Note: "n"},
		{Question: "=HYPERLINK(\"x\")", Expected: Expected{Filenames: []string{"guide.pdf"}}},
	}
	var buf bytes.Buffer
	if err := WriteCSV(&buf, in); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "'=HYPERLINK") {
		t.Errorf("a formula cell wasn't neutralised: %s", buf.String())
	}
	rows, probs := ParseCSV(buf.String())
	if len(probs) != 0 || len(rows) != 2 {
		t.Fatalf("rows %+v problems %+v", rows, probs)
	}
	if rows[0].Question != "How, exactly?" || rows[0].Expected.DocumentIDs[0] != id || strings.Join(rows[0].MustMention, ",") != "fee,form" || rows[0].Note != "n" {
		t.Errorf("row 1 = %+v", rows[0])
	}
	if rows[1].Question != `=HYPERLINK("x")` || rows[1].Expected.Filenames[0] != "guide.pdf" {
		t.Errorf("row 2 = %+v", rows[1])
	}
}
