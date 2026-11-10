package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// Processor holds the dependencies for processing documents.
type Processor struct {
	Pool       *pgxpool.Pool
	Blob       blob.Store
	Parser     *parse.Router
	Counter    chunk.TokenCounter
	Catalog    *catalog.Service
	Vectors    vectorstore.Store
	EmbedBatch int // inputs per embedding request without a Batcher (default 64)
	// Batcher shares embedding requests between documents (nil: each
	// document is embedded with its own requests).
	Batcher  *Batcher
	MaxBytes int64 // largest original read into memory (default 128 MiB)
	// Boilerplate are the platform defaults for repeated-block suppression
	// (ADR-0021); a zero value turns it off for every source without
	// overrides.
	Boilerplate boilerplate.Defaults
	// Maintenance parks documents and boilerplate refreshes while
	// maintenance mode is on (nil: never; docs/phase5-deploy.md §5 P5).
	Maintenance *platform.MaintenanceGate
	// Dispatcher, when set, refills a finishing document's slot in its
	// commit transaction instead of kicking a dispatch job (refill).
	Dispatcher *DispatchWorker
	// OCR reads pages without text and images when it is on (nil: off;
	// docs/ocr.md).
	OCR *ocr.Service
	// Budget, when set, holds back a team's documents while its enforced monthly budget is used up (they wait).
	Budget TeamBudget
	// Contextual writes the context of contextual chunks (nil: not wired; every source embeds as before). ContextualOff is the platform
	// switch CONTEXTUAL_CHUNKS=false (docs/contextual-chunks.md).
	Contextual    *contextual.Generator
	ContextualOff bool
	Log           *slog.Logger

	ensured sync.Map // profile ID -> struct{}: vector table exists
}

// Status values.
const (
	StatusReady   = "ready"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"
)

// result is the output of the slow, lock-free part of processing.
type result struct {
	kind    parse.Kind
	parsed  parse.Document // parsed.OCR: the pages read with OCR
	chunks  []chunk.Chunk
	plan    bpPlan
	vectors [][]float32
	target  catalog.EmbedTarget
	usage   EmbedUsage
	mark    *ctxMark // how contextual chunks applied (nil: not at all)
	pii     *pii.Record
}

func (p *Processor) process(ctx context.Context, doc dbgen.Document) (result, error) {
	var res result
	if err := p.checkBudget(ctx, doc.TeamID); err != nil {
		return res, err
	}
	q := dbgen.New(p.Pool)
	src, err := q.GetSource(ctx, doc.SourceID)
	if err != nil {
		return res, err
	}
	if res.target, err = p.Catalog.EmbedTarget(ctx, src.EmbeddingProfileID); err != nil {
		return res, err
	}

	data, err := p.read(ctx, doc.BlobKey)
	if err != nil {
		return res, err
	}
	res.parsed, res.kind, err = p.parse(ctx, src, doc, data)
	if err != nil {
		return res, err
	}
	if res.pii, err = p.scanPII(ctx, q, src, doc, res.parsed); err != nil {
		return res, err
	}
	if key := parsedKey(doc.BlobKey); key != "" {
		md := res.parsed.Markdown
		if perr := p.Blob.Put(ctx, key, strings.NewReader(md), int64(len(md)), "text/markdown; charset=utf-8"); perr != nil {
			p.Log.WarnContext(ctx, "could not store parsed markdown", "document", doc.ID, "err", perr)
		}
	}

	if res.plan, err = p.planBoilerplate(ctx, q, src, doc.ID, chunk.Blocks(res.parsed.Markdown)); err != nil {
		return res, err
	}
	if res.chunks, err = p.split(res.parsed.Markdown, res.target, res.plan); err != nil {
		return res, err
	}
	if len(res.chunks) == 0 {
		return res, parse.ErrEmpty
	}
	title := res.parsed.Title
	if title == "" {
		title = doc.Title
	}
	sc := ctxScope{src: src, docID: doc.ID, title: title, team: doc.TeamID, user: doc.UploadedBy, own: true}
	texts, mark, err := p.contextualTexts(ctx, sc, doc.Version, res.target, res.chunks)
	if err != nil {
		return res, err
	}
	res.mark = mark
	res.vectors, res.usage, err = p.embed(ctx, res.target, texts, doc.TeamID)
	return res, err
}

// parse detects a document's kind and parses its original.
func (p *Processor) parse(ctx context.Context, src dbgen.DataSource, doc dbgen.Document, data []byte) (parse.Document, parse.Kind, error) {
	name := doc.Filename
	if name == "" {
		name = doc.ExternalID
	}
	in := parse.Input{Name: name, Data: data}
	var err error
	if src.Type == "web" {
		// URLs carry no reliable extension: the content and the server's
		// Content-Type decide. Web HTML keeps only the main content.
		if in.Kind, err = parse.Detect("", data); err != nil {
			return parse.Document{}, "", err
		}
		if in.Kind == parse.KindImage { // the crawler ignores images (docs/ocr.md §5a)
			return parse.Document{}, "", fmt.Errorf("%w: images from websites are not indexed", parse.ErrUnsupported)
		}
		in.Kind = webKind(in.Kind, doc.ContentType)
		in.WebPage, in.BaseURL = true, doc.URL
		in.Name = webPageName(name)
	} else if in.Kind, err = parse.Detect(name, data); err != nil {
		return parse.Document{}, "", err
	}
	plan, err := p.ocrPlan(ctx, src, doc, in.Kind)
	if err != nil {
		return parse.Document{}, in.Kind, err
	}
	in.OCR = plan.Options
	parseCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	parsed, err := p.Parser.Parse(parseCtx, in)
	if uerr := p.recordOCRUsage(ctx, doc, parsed.OCR, plan.ModelID); uerr != nil {
		return parsed, in.Kind, errors.Join(err, uerr)
	}
	return parsed, in.Kind, err
}

// webPageName is the name a web page's title falls back to when the page
// has none (plain text, a heading-less page): its URL decoded, so
// "?fileprint=/doc%2Fcodewalk%2Fpig.go" reads "pig", not
// "doc%2Fcodewalk%2Fpig" (VI-10).
func webPageName(rawURL string) string {
	if s, err := url.QueryUnescape(rawURL); err == nil {
		return s
	}
	return rawURL
}

// split chunks parsed Markdown with the profile's sizes, leaving out the
// plan's boilerplate blocks and image-only chunks.
func (p *Processor) split(md string, t catalog.EmbedTarget, plan bpPlan) ([]chunk.Chunk, error) {
	c := ChunkingOf(t.Profile, t.MaxInputTokens)
	opts := chunk.Options{MaxTokens: c.MaxTokens, OverlapTokens: c.Overlap, Counter: p.Counter, DropImageOnly: true, Version: c.Version}
	if len(plan.drop) > 0 {
		opts.DropBlock = func(text string) bool { return plan.drop[text] }
	}
	return chunk.Split(md, opts)
}

// webKind refines a sniffed text kind with the page's Content-Type.
func webKind(sniffed parse.Kind, contentType string) parse.Kind {
	if sniffed != parse.KindText && sniffed != parse.KindHTML {
		return sniffed // PDF, DOCX, PPTX: the content decides
	}
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "text/html", "application/xhtml+xml":
		return parse.KindHTML
	case "text/markdown", "text/x-markdown":
		return parse.KindMarkdown
	case "text/plain":
		return parse.KindText
	}
	return sniffed
}

func (p *Processor) read(ctx context.Context, key string) ([]byte, error) {
	rc, err := p.Blob.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	limit := p.MaxBytes
	if limit <= 0 {
		limit = 128 << 20
	}
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, parse.ErrTooLarge
	}
	return data, nil
}

// parsedKey stores parsed Markdown next to the original.
func parsedKey(originalKey string) string {
	if !strings.HasSuffix(originalKey, "/original") {
		return ""
	}
	return strings.TrimSuffix(originalKey, "original") + "parsed.md"
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
