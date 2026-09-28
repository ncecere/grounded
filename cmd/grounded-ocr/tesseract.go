package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Tesseract runs the tesseract program (no CGO, no library bindings).
type Tesseract struct {
	Program string
}

// langRE is a "+"-joined list of language codes: it is passed as one
// argument, and can't start with "-".
var langRE = regexp.MustCompile(`^[a-z_]{3,16}(\+[a-z_]{3,16}){0,9}$`)

// errBadImage: tesseract could not read the image.
var errBadImage = errors.New("tesseract could not read the image")

// Result is one page's text and mean word confidence (0-1).
type Result struct {
	Text       string  `json:"text"`
	Confidence float64 `json:"confidence"`
}

// command builds a tesseract run. OMP_THREAD_LIMIT=1: requests run in
// parallel already (one per CPU), so tesseract's own threads would only
// oversubscribe the CPUs.
func (t *Tesseract) command(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, t.Program, args...)
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	cmd.WaitDelay = 5 * time.Second
	return cmd
}

// Version is the first line of `tesseract --version`.
func (t *Tesseract) Version(ctx context.Context) (string, error) {
	out, err := t.command(ctx, "--version").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s --version: %w", t.Program, err)
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	return strings.TrimSpace(line), nil
}

// Languages lists the installed languages (`tesseract --list-langs`),
// without "osd" (orientation detection, not a language).
func (t *Tesseract) Languages(ctx context.Context) ([]string, error) {
	out, err := t.command(ctx, "--list-langs").Output()
	if err != nil {
		return nil, fmt.Errorf("%s --list-langs: %w", t.Program, err)
	}
	var langs []string
	for _, l := range strings.Split(string(out), "\n") {
		l = strings.TrimSpace(l)
		if l == "" || l == "osd" || strings.HasPrefix(l, "List of") || !langRE.MatchString(l) {
			continue
		}
		langs = append(langs, l)
	}
	sort.Strings(langs)
	return langs, nil
}

// Recognize reads a PNG with the languages. The image and tesseract's
// output files live in a temporary directory removed on return.
func (t *Tesseract) Recognize(ctx context.Context, png []byte, langs string) (Result, error) {
	dir, err := os.MkdirTemp("", "grounded-ocr-")
	if err != nil {
		return Result{}, err
	}
	defer os.RemoveAll(dir)
	in := filepath.Join(dir, "page.png")
	if err := os.WriteFile(in, png, 0o600); err != nil {
		return Result{}, err
	}
	base := filepath.Join(dir, "out")
	// One run writes both the text (out.txt) and the words with their
	// confidences (out.tsv).
	cmd := t.command(ctx, in, base, "-l", langs, "txt", "tsv")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		return Result{}, fmt.Errorf("%w: %s", errBadImage, lastLine(stderr.String()))
	}
	text, err := os.ReadFile(base + ".txt")
	if err != nil {
		return Result{}, fmt.Errorf("%w: no text output", errBadImage)
	}
	tsv, _ := os.Open(base + ".tsv")
	conf := 0.0
	if tsv != nil {
		conf = meanConfidence(tsv)
		tsv.Close()
	}
	return Result{Text: strings.TrimRight(strings.ReplaceAll(string(text), "\f", ""), "\n") + "\n", Confidence: conf}, nil
}

// meanConfidence averages the confidence of the words (TSV level 5 rows;
// -1 marks non-words) on a 0-1 scale.
func meanConfidence(r io.Reader) float64 {
	cr := csv.NewReader(r)
	cr.Comma, cr.FieldsPerRecord, cr.LazyQuotes = '\t', -1, true
	sum, n := 0.0, 0
	for {
		rec, err := cr.Read()
		if err != nil {
			break
		}
		if len(rec) < 12 || rec[0] != "5" || strings.TrimSpace(rec[11]) == "" {
			continue
		}
		c, err := strconv.ParseFloat(rec[10], 64)
		if err != nil || c < 0 {
			continue
		}
		sum += c
		n++
	}
	if n == 0 {
		return 0
	}
	return float64(int(sum/float64(n)*10+0.5)) / 1000
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
