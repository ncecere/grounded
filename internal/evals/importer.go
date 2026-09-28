// Importing and exporting questions (docs/evaluations.md §1): CSV
// (question,expected,must_mention[,note], with | between several values)
// and ragbench's URL-judged JSONL ({"id","question","urls":[...]}, as
// cmd/sparkbench reads it). Rows that can't be used are reported with their
// line; the others are added.

package evals

import (
	"bufio"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/apperr"
)

// Import formats.
const (
	FormatCSV   = "csv"
	FormatJSONL = "jsonl"
)

// Limits of an import.
const (
	MaxImportBytes = 2 << 20
	MaxImportRows  = 2000
)

// CaseInput is a question as typed or imported.
type CaseInput struct {
	Question    string
	Expected    Expected
	MustMention []string
	Note        string
}

// Normalize checks a question: 1-4,000 characters, expected documents, at
// most 20 must-mention phrases and a note of at most 2000 characters.
func (in CaseInput) Normalize() (CaseInput, error) {
	out := CaseInput{Question: strings.TrimSpace(in.Question), Note: strings.TrimSpace(in.Note)}
	if out.Question == "" {
		return out, apperr.Invalid("invalid_question", "The question is empty.")
	}
	if utf8.RuneCountInString(out.Question) > MaxQuestionChars {
		return out, apperr.Invalid("invalid_question", fmt.Sprintf("The question must be 1–%s characters.", thousands(MaxQuestionChars)))
	}
	if utf8.RuneCountInString(out.Note) > MaxNoteChars {
		return out, apperr.Invalid("invalid_note", fmt.Sprintf("The note can be at most %s characters.", thousands(MaxNoteChars)))
	}
	var err error
	if out.Expected, err = in.Expected.Normalize(); err != nil {
		return out, err
	}
	if out.MustMention, err = NormalizePhrases(in.MustMention); err != nil {
		return out, err
	}
	return out, nil
}

// ImportRow is a usable row of an import.
type ImportRow struct {
	Line int
	CaseInput
}

// ImportProblem is a row that can't be used, and why.
type ImportProblem struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// Parse reads an import in the format; problems name the rows it skips.
func Parse(format, content string) ([]ImportRow, []ImportProblem, error) {
	if len(content) > MaxImportBytes {
		return nil, nil, apperr.Invalid("import_too_large", fmt.Sprintf("Imports can be at most %d MiB", MaxImportBytes>>20))
	}
	var rows []ImportRow
	var probs []ImportProblem
	switch format {
	case FormatCSV:
		rows, probs = ParseCSV(content)
	case FormatJSONL:
		rows, probs = ParseJSONL(content)
	default:
		return nil, nil, apperr.Invalid("invalid_format", "The format must be csv or jsonl")
	}
	if len(rows)+len(probs) > MaxImportRows {
		return nil, nil, apperr.Invalid("import_too_large", fmt.Sprintf("Imports can have at most %d rows", MaxImportRows))
	}
	return rows, probs, nil
}

// thousands writes n with a thousands separator: 4000 is "4,000".
func thousands(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// problemText is the message of a validation error.
func problemText(err error) string {
	if e, ok := apperr.As(err); ok {
		return e.Message
	}
	return err.Error()
}

// ParseCSV reads question,expected,must_mention[,note] rows. A first row
// starting with "question" is a header.
func ParseCSV(content string) ([]ImportRow, []ImportProblem) {
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(content, "\ufeff")))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	var rows []ImportRow
	var probs []ImportProblem
	for first := true; ; first = false {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			line := 0
			var pe *csv.ParseError
			if errors.As(err, &pe) {
				line = pe.StartLine
			}
			probs = append(probs, ImportProblem{Line: line, Message: "This line isn't valid CSV, so the rest of the file wasn't read: " + err.Error() + "."})
			break
		}
		line, _ := r.FieldPos(0)
		if first && strings.EqualFold(strings.TrimSpace(rec[0]), "question") {
			continue
		}
		if len(rec) == 1 && strings.TrimSpace(rec[0]) == "" {
			continue // a blank line
		}
		for i := range rec {
			rec[i] = unsafeCell(rec[i])
		}
		in := CaseInput{Question: rec[0]}
		if len(rec) > 1 {
			e, err := ParseExpected(rec[1])
			if err != nil {
				probs = append(probs, ImportProblem{Line: line, Message: problemText(err)})
				continue
			}
			in.Expected = e
		}
		if len(rec) > 2 {
			in.MustMention = SplitList(rec[2])
		}
		if len(rec) > 3 {
			in.Note = rec[3]
		}
		rows, probs = addRow(rows, probs, line, in)
	}
	return rows, probs
}

// urlQuestion is one line of a URL-judged set (ragbench urlset).
type urlQuestion struct {
	ID       string   `json:"id"`
	Question string   `json:"question"`
	URLs     []string `json:"urls"`
}

// ParseJSONL reads {"id","question","urls":[...]} lines; blank lines are
// skipped. The id isn't kept.
func ParseJSONL(content string) ([]ImportRow, []ImportProblem) {
	sc := bufio.NewScanner(strings.NewReader(content))
	sc.Buffer(make([]byte, 64<<10), MaxImportBytes)
	var rows []ImportRow
	var probs []ImportProblem
	for line := 1; sc.Scan(); line++ {
		raw := bytes.TrimSpace(sc.Bytes())
		if len(raw) == 0 {
			continue
		}
		var q urlQuestion
		if err := json.Unmarshal(raw, &q); err != nil {
			probs = append(probs, ImportProblem{Line: line, Message: "This line isn't a JSON object with question and urls."})
			continue
		}
		rows, probs = addRow(rows, probs, line, CaseInput{Question: q.Question, Expected: Expected{URLs: q.URLs}})
	}
	return rows, probs
}

// addRow validates a row and adds it, or its problem.
func addRow(rows []ImportRow, probs []ImportProblem, line int, in CaseInput) ([]ImportRow, []ImportProblem) {
	n, err := in.Normalize()
	if err != nil {
		return rows, append(probs, ImportProblem{Line: line, Message: problemText(err)})
	}
	return append(rows, ImportRow{Line: line, CaseInput: n}), probs
}

// Dedupe drops rows repeating a question already in the set or earlier in
// the import (case and spacing aside), as problems.
func Dedupe(rows []ImportRow, existing []string) ([]ImportRow, []ImportProblem) {
	key := func(q string) string { return strings.ToLower(strings.Join(strings.Fields(q), " ")) }
	seen := map[string]bool{}
	for _, q := range existing {
		seen[key(q)] = true
	}
	var out []ImportRow
	var probs []ImportProblem
	for _, r := range rows {
		k := key(r.Question)
		if seen[k] {
			probs = append(probs, ImportProblem{Line: r.Line, Message: "This question is already in the set."})
			continue
		}
		seen[k] = true
		out = append(out, r)
	}
	return out, probs
}

// ExportRow is a question for the CSV export.
type ExportRow struct {
	Question    string
	Expected    Expected
	MustMention []string
	Note        string
}

// WriteCSV writes questions in the import's CSV format, with a header.
func WriteCSV(w io.Writer, rows []ExportRow) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"question", "expected", "must_mention", "note"}); err != nil {
		return err
	}
	for _, r := range rows {
		cells := []string{r.Question, r.Expected.String(), strings.Join(r.MustMention, " | "), r.Note}
		for i, c := range cells {
			cells[i] = safeCell(c)
		}
		if err := cw.Write(cells); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// formulaStart are first characters spreadsheets read as a formula.
const formulaStart = "=+-@\t\r"

// safeCell keeps a spreadsheet from running a cell as a formula: such a cell
// gets a leading apostrophe, which the import removes again.
func safeCell(c string) string {
	if c != "" && strings.ContainsRune(formulaStart, rune(c[0])) {
		return "'" + c
	}
	return c
}

// unsafeCell removes the apostrophe safeCell added.
func unsafeCell(c string) string {
	if len(c) > 1 && c[0] == '\'' && strings.ContainsRune(formulaStart, rune(c[1])) {
		return c[1:]
	}
	return c
}
