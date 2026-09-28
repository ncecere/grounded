package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/systemone"
)

// judgedAnswer is an answer with its SystemOne verdict.
type judgedAnswer struct {
	answerRecord
	Verdict       string             `json:"verdict"`
	Confidence    float64            `json:"confidence"`
	Probabilities map[string]float64 `json:"probabilities"`
}

const judgeInstructions = "`expected_page` is the university web page that answers `question`; treat it as ground truth. " +
	"Does `answer` correctly answer `question`?"

var judgeCriteria = map[string]string{
	"correct":   "The answer gives the information the question asks for, and it agrees with expected_page. Extra correct detail is fine.",
	"partially": "The answer is on topic and partly right, but it leaves out a key part of what was asked, is vague where the page is specific, or contains a minor error.",
	"incorrect": "The answer is wrong, contradicts expected_page, answers a different question, or gives no answer (for example a refusal or 'the sources don't say').",
}

// judger grades answer files.
type judger struct {
	judge    *endpoint
	pool     *pgxpool.Pool
	kb       urlSetKB
	maxChars int
	pages    map[string]string
}

func cmdJudge(args []string) error {
	fs := flag.NewFlagSet("judge", flag.ExitOnError)
	in := fs.String("in", "/tmp/sparkbench/answers-spark-chat.jsonl,/tmp/sparkbench/answers-gateway-chat.jsonl", "comma-separated answer files")
	dsn := fs.String("dsn", defaultDevDSN, "dev Grounded database (read-only use) for the expected pages' text")
	kbName := fs.String("kb-name", "", "knowledge base holding the expected pages (required)")
	maxChars := fs.Int("max-page-chars", 30000, "truncate each expected page's text to this many characters")
	outSuffix := fs.String("out-suffix", ".judged.jsonl", "judged output is written next to each input with this suffix")
	reuse := fs.Bool("reuse", true, "reuse verdicts already in the judged output files (no SystemOne calls for them)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), `usage: sparkbench judge [flags]

Grades each answer with a SystemOne "choice" question (correct | partially |
incorrect, with confidence): the state holds the question, the answer (citation
markers removed) and the expected page's full text from the KB. Uses the
request/response types of internal/systemone. Prints a comparison table per
answer file and a per-question table.`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	ctx := context.Background()
	judge, err := newEndpoint("systemone", 0)
	if err != nil {
		return err
	}
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	kb, err := loadURLSetKB(ctx, pool, *kbName)
	if err != nil {
		return err
	}
	j := &judger{judge: judge, pool: pool, kb: kb, maxChars: *maxChars, pages: map[string]string{}}
	var files []string
	all := map[string][]judgedAnswer{}
	for _, path := range strings.Split(*in, ",") {
		if path = strings.TrimSpace(path); path == "" {
			continue
		}
		files = append(files, path)
		if all[path], err = j.file(ctx, path, strings.TrimSuffix(path, ".jsonl")+*outSuffix, *reuse); err != nil {
			return err
		}
	}
	printJudgeTables(files, all)
	return nil
}

// file grades one answer file and writes the judged copy.
func (j *judger) file(ctx context.Context, path, outPath string, reuse bool) ([]judgedAnswer, error) {
	prev := map[string]judgedAnswer{}
	if reuse {
		_ = readJSONL(outPath, func(ja judgedAnswer) error {
			if ja.Verdict != "" {
				prev[ja.ID] = ja
			}
			return nil
		})
	}
	var recs []answerRecord
	if err := readJSONL(path, func(r answerRecord) error {
		recs = append(recs, r)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Slice(recs, func(a, b int) bool { return recs[a].ID < recs[b].ID })
	f, err := os.Create(outPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []judgedAnswer
	for _, r := range recs {
		ja := judgedAnswer{answerRecord: r}
		if p, ok := prev[r.ID]; ok && p.Answer == r.Answer {
			ja = p
		} else if r.Error == "" {
			if err := j.grade(ctx, &ja); err != nil {
				return nil, fmt.Errorf("%s %s: %w", path, r.ID, err)
			}
		}
		b, _ := json.Marshal(ja)
		f.Write(append(b, '\n'))
		out = append(out, ja)
	}
	log.Printf("judged %s -> %s", path, outPath)
	return out, nil
}

// pageText is the expected page's chunks in order, truncated.
func (j *judger) pageText(ctx context.Context, url string) (string, error) {
	if t, ok := j.pages[url]; ok {
		return t, nil
	}
	rows, err := j.pool.Query(ctx, `SELECT c.content FROM chunks c JOIN documents d ON d.id = c.document_id
		WHERE c.source_id = ANY($1::uuid[]) AND rtrim(d.url, '/') = $2 ORDER BY c.ordinal`, j.kb.sources, normURL(url))
	if err != nil {
		return "", err
	}
	parts, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	t := truncate(strings.Join(parts, "\n\n"), j.maxChars)
	j.pages[url] = t
	return t, nil
}

// grade asks SystemOne whether the answer is correct given the page(s).
func (j *judger) grade(ctx context.Context, ja *judgedAnswer) error {
	var page []map[string]string
	for _, u := range ja.Expected {
		t, err := j.pageText(ctx, u)
		if err != nil {
			return err
		}
		page = append(page, map[string]string{"url": u, "text": t})
	}
	answer := strings.Join(strings.Fields(removeMarkers(ja.Answer)), " ")
	state := map[string]any{"question": ja.Question, "answer": answer, "expected_page": page}
	if len(page) == 1 {
		state["expected_page"] = page[0]
	}
	qs := map[string]systemone.Question{"verdict": systemone.Choice(judgeInstructions, judgeCriteria)}
	resp, err := j.judge.post(ctx, "/systemone", systemone.Request{State: state, Model: j.judge.model, Questions: qs})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var out systemone.Response
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return err
	}
	if err := systemone.Validate(qs, &out); err != nil {
		return err
	}
	a := out.Answers["verdict"]
	ja.Verdict, ja.Probabilities = a.Choice, a.Probabilities
	if a.Confidence != nil {
		ja.Confidence = *a.Confidence
	}
	return nil
}
