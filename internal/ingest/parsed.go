// A document's parse, kept next to its original so a retry does not parse it again (#250). The parsed Markdown is
// parsed.md (also read by the boilerplate re-chunk and the profile migration); parsed.json beside it records the rest of
// what parsing produced: title, pages, parser, warnings and the pages read with OCR. A retry after an embedding outage,
// backpressure, a budget or limit wait or a profile move starts from chunking: the original is not read again, the
// parser does not run, and no page is read or counted with OCR a second time (docs/ocr.md: OCR usage is recorded once,
// when the pages are read).
//
// The record is written after parsed.md, so its presence means both are complete, and it names the document version
// and content digest it was made from: each stored version has keys of its own (keys.go), and a record that does not
// match is ignored. A parse that skipped pages because OCR was off (NeedsOCR) is never recorded: retrying such a
// document is how it gets those pages read once OCR is on.

package ingest

import (
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// parseRecordFormat is the record's layout version; a record of another format is ignored.
const parseRecordFormat = 1

// maxParseRecordBytes bounds the record read back (warnings are clipped by the parsers; this is a guard).
const maxParseRecordBytes = 1 << 20

// parseRecord is parsed.json.
type parseRecord struct {
	Format   int            `json:"format"`
	Version  int32          `json:"version"`
	Sha256   string         `json:"sha256"`
	Bytes    int            `json:"bytes"` // len(parsed.md)
	Kind     parse.Kind     `json:"kind"`
	Title    string         `json:"title"`
	Pages    int            `json:"pages"`
	Parser   string         `json:"parser"`
	Warnings []string       `json:"warnings"`
	OCR      *parse.OCRInfo `json:"ocr,omitempty"`
}

// parseRecordKey is the key of a stored version's parse record ("" when the original's key has no version folder).
func parseRecordKey(originalKey string) string {
	if !strings.HasSuffix(originalKey, "/original") {
		return ""
	}
	return strings.TrimSuffix(originalKey, "original") + "parsed.json"
}

// parsedDocument is the document's parse: the stored one when this version was parsed before, else its original read
// and parsed now (and stored). The PII scan runs either way, with the platform's current settings.
func (p *Processor) parsedDocument(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, doc dbgen.Document) (parse.Document, parse.Kind, *pii.Record, error) {
	if parsed, kind, ok := p.storedParse(ctx, doc); ok {
		rec, err := p.scanPII(ctx, q, src, doc, parsed)
		return parsed, kind, rec, err
	}
	data, err := p.read(ctx, doc.BlobKey)
	if err != nil {
		return parse.Document{}, "", nil, err
	}
	parsed, kind, err := p.parse(ctx, src, doc, data)
	if err != nil {
		return parsed, kind, nil, err
	}
	rec, err := p.scanPII(ctx, q, src, doc, parsed)
	if err != nil {
		return parsed, kind, rec, err
	}
	p.storeParse(ctx, doc, kind, parsed)
	return parsed, kind, rec, nil
}

// storeParse writes parsed.md and then its record. Failures are logged, not returned: they cost a parse on retry.
func (p *Processor) storeParse(ctx context.Context, doc dbgen.Document, kind parse.Kind, parsed parse.Document) {
	key, recKey := parsedKey(doc.BlobKey), parseRecordKey(doc.BlobKey)
	if key == "" {
		return
	}
	md := parsed.Markdown
	if err := p.Blob.Put(ctx, key, strings.NewReader(md), int64(len(md)), "text/markdown; charset=utf-8"); err != nil {
		p.Log.WarnContext(ctx, "could not store parsed markdown", "document", doc.ID, "err", err)
		return
	}
	if len(parsed.NeedsOCR) > 0 {
		return // parsed again on retry, with OCR if it is on by then
	}
	rec, err := json.Marshal(parseRecord{Format: parseRecordFormat, Version: doc.Version, Sha256: doc.Sha256, Bytes: len(md), Kind: kind,
		Title: parsed.Title, Pages: parsed.Pages, Parser: parsed.Parser, Warnings: parsed.Warnings, OCR: parsed.OCR})
	if err != nil {
		return
	}
	if err := p.Blob.Put(ctx, recKey, strings.NewReader(string(rec)), int64(len(rec)), "application/json"); err != nil {
		p.Log.WarnContext(ctx, "could not store the parse record", "document", doc.ID, "err", err)
	}
}

// storedParse reads back this version's parse, if it has one that matches. Anything missing or unexpected is a miss
// (the document is parsed again), never an error.
func (p *Processor) storedParse(ctx context.Context, doc dbgen.Document) (parse.Document, parse.Kind, bool) {
	recKey := parseRecordKey(doc.BlobKey)
	if recKey == "" || p.Blob == nil {
		return parse.Document{}, "", false
	}
	rc, err := p.Blob.Get(ctx, recKey)
	if err != nil {
		return parse.Document{}, "", false // not parsed before (or stored before #250)
	}
	raw, err := io.ReadAll(io.LimitReader(rc, maxParseRecordBytes+1))
	rc.Close()
	var rec parseRecord
	if err != nil || len(raw) > maxParseRecordBytes || json.Unmarshal(raw, &rec) != nil {
		return parse.Document{}, "", false
	}
	if rec.Format != parseRecordFormat || rec.Version != doc.Version || rec.Sha256 != doc.Sha256 {
		return parse.Document{}, "", false
	}
	md, err := p.readParsed(ctx, doc.BlobKey)
	if err != nil || len(md) != rec.Bytes {
		return parse.Document{}, "", false
	}
	p.Log.InfoContext(ctx, "reusing the stored parse", "document", doc.ID, "version", doc.Version)
	return parse.Document{Title: rec.Title, Markdown: md, Pages: rec.Pages, Parser: rec.Parser, Warnings: rec.Warnings, OCR: rec.OCR}, rec.Kind, true
}
