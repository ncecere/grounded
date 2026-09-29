// Processing one frontier URL: fetching it, storing new and changed pages
// and following links (docs/phase2-web-sources.md §3).

package web

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// counts are per-page counter increments.
type counts struct {
	discovered, fetched, changed, unchanged, skipped, failed int32
}

// skipReason maps fetch errors that skip a page to a frontier reason.
func skipReason(err error) string {
	switch {
	case errors.Is(err, crawl.ErrRobotsDisallowed):
		return "robots_disallowed"
	case errors.Is(err, crawl.ErrHostNotAllowed):
		return "host_not_allowed"
	case errors.Is(err, crawl.ErrBlockedAddress):
		return "blocked_address"
	case errors.Is(err, crawl.ErrUnsupportedContent):
		return "unsupported_content"
	}
	return ""
}

func isHTML(contentType string) bool {
	return contentType == crawl.TypeHTML || contentType == crawl.TypeXHTML
}

// page fetches one frontier URL and records the outcome (see the table in
// docs/phase2-web-sources.md §3).
func (r *run) page(ctx context.Context, rawURL string, depth int) error {
	v := &pageVisit{r: r, url: rawURL, depth: depth}
	var err error
	if v.known, v.found, err = r.document(ctx, rawURL); err != nil {
		return err
	}
	etag, lastModified := "", ""
	v.stale = v.found && parse.StaleHTML(v.known.Parser)
	if v.found && v.known.Status != "failed" && !v.stale {
		etag, lastModified = v.known.HttpEtag, v.known.HttpLastModified
	}
	start := time.Now()
	pg, ferr := r.s.Fetcher.FetchIf(ctx, rawURL, etag, lastModified)
	observability.CrawlFetchDuration.Observe(time.Since(start).Seconds())
	if ferr != nil {
		return v.fetchFailed(ctx, pg, ferr)
	}
	v.c.fetched = 1
	switch {
	case pg.Status == 304:
		v.c.unchanged = 1
		if err := v.keepStored(ctx, pg.ETag, pg.LastModified); err != nil {
			return err
		}
		return v.mark(ctx, "done", "", pg.Status)
	case pg.Status == 404 || pg.Status == 410:
		// Not seen: a page that is gone is deleted at the end of the run.
		v.c.failed = 1
		return v.mark(ctx, "failed", "not_found", pg.Status)
	case pg.Status < 200 || pg.Status >= 300:
		v.c.failed = 1
		if err := v.keepStored(ctx, "", ""); err != nil {
			return err
		}
		return v.mark(ctx, "failed", "http_error", pg.Status)
	}
	return v.fetched(ctx, pg)
}

// pageVisit is the processing of one frontier URL.
type pageVisit struct {
	r     *run
	url   string // the frontier URL
	depth int
	c     counts
	// known is the page's stored document (found), by final URL once a
	// redirect is followed.
	known dbgen.Document
	found bool
	// stale: the stored version was parsed by an older HTML parser, so the
	// page is fetched unconditionally and stored again even when unchanged.
	stale bool
}

// mark records the frontier URL's outcome and the counts.
func (v *pageVisit) mark(ctx context.Context, status, reason string, httpStatus int) error {
	q, c := v.r.s.q, v.c
	if err := q.MarkFrontier(ctx, dbgen.MarkFrontierParams{
		CrawlID: v.r.crawl.ID, URL: v.url, Status: status, Reason: reason, HttpStatus: int32(httpStatus),
	}); err != nil {
		return err
	}
	observability.CrawlPages.WithLabelValues(status).Inc()
	return q.AddCrawlCounts(ctx, dbgen.AddCrawlCountsParams{
		ID: v.r.crawl.ID, Discovered: c.discovered, Fetched: c.fetched, Changed: c.changed,
		Unchanged: c.unchanged, Skipped: c.skipped, Failed: c.failed,
	})
}

// seen marks the stored document as seen by this run.
func (v *pageVisit) seen(ctx context.Context, etag, lastModified string) error {
	return v.r.s.q.MarkDocumentSeen(ctx, dbgen.MarkDocumentSeenParams{
		ID: v.known.ID, CrawlID: uuid.NullUUID{UUID: v.r.crawl.ID, Valid: true}, HttpEtag: etag, HttpLastModified: lastModified,
	})
}

// keepStored keeps the stored version of an unchanged or unavailable page
// (if any): it is marked seen and its links are followed.
func (v *pageVisit) keepStored(ctx context.Context, etag, lastModified string) error {
	if !v.found {
		return nil
	}
	if err := v.seen(ctx, etag, lastModified); err != nil {
		return err
	}
	return v.r.followStored(ctx, v.known, v.depth, &v.c)
}

// fetchFailed records a page that could not be fetched.
func (v *pageVisit) fetchFailed(ctx context.Context, pg crawl.Page, ferr error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if reason := skipReason(ferr); reason != "" {
		v.c.skipped = 1
		return v.mark(ctx, "skipped", reason, pg.Status)
	}
	// Network error or bad redirect: keep the previous version and its
	// links, so a transient outage deletes nothing.
	v.c.fetched, v.c.failed = 1, 1
	if err := v.keepStored(ctx, "", ""); err != nil {
		return err
	}
	return v.mark(ctx, "failed", clip(ferr.Error(), 300), 0)
}

// fetched records a 2xx page: stored when new or changed, then its links
// are followed.
func (v *pageVisit) fetched(ctx context.Context, pg crawl.Page) error {
	final, reason, err := v.redirected(ctx, pg)
	if err != nil {
		return err
	}
	if reason != "" {
		v.c.fetched, v.c.skipped = 0, 1
		return v.mark(ctx, "skipped", reason, pg.Status)
	}
	if pg.Truncated {
		v.c.skipped = 1
		return v.mark(ctx, "skipped", "too_large", pg.Status)
	}
	sum := sha256.Sum256(pg.Body)
	digest := hex.EncodeToString(sum[:])
	if v.found && v.known.Sha256 == digest && v.known.Status != "failed" && !v.stale {
		v.c.unchanged = 1
		if err := v.seen(ctx, pg.ETag, pg.LastModified); err != nil {
			return err
		}
	} else {
		v.c.changed = 1
		if err := v.r.store(ctx, final, pg, digest, v.known, v.found); err != nil {
			var stop *limitStop
			if errors.As(err, &stop) {
				v.c.changed, v.c.skipped = 0, 1
				if merr := v.mark(ctx, "skipped", stop.reason, pg.Status); merr != nil {
					return merr
				}
			}
			return err
		}
	}
	if v.r.cfg.Mode == ModeCrawl && isHTML(pg.ContentType) {
		if err := v.r.follow(ctx, pg.Body, final, v.depth, &v.c); err != nil {
			return err
		}
	}
	return v.mark(ctx, "done", "", pg.Status)
}

// redirected returns the page's final URL after redirects, which is the
// document's identity, and looks up its document. reason is set when the
// final URL is skipped (too long, out of scope).
func (v *pageVisit) redirected(ctx context.Context, pg crawl.Page) (final, reason string, err error) {
	final = pg.FinalURL
	if final == "" || final == v.url {
		return v.url, "", nil
	}
	if len(final) > MaxURLBytes {
		return final, "url_too_long", nil
	}
	if v.r.cfg.Mode == ModeCrawl {
		if ok, reason := v.r.scope.Allows(final, v.depth); !ok {
			if !strings.HasPrefix(reason, "trap_") {
				reason = "out_of_scope"
			}
			return final, reason, nil
		}
	}
	if err := v.r.s.q.MarkFrontierFetched(ctx, dbgen.MarkFrontierFetchedParams{CrawlID: v.r.crawl.ID, URL: final, Depth: int32(v.depth)}); err != nil {
		return final, "", err
	}
	v.known, v.found, err = v.r.document(ctx, final)
	v.stale = v.found && parse.StaleHTML(v.known.Parser)
	return final, "", err
}

func (r *run) document(ctx context.Context, externalID string) (dbgen.Document, bool, error) {
	doc, err := r.s.q.FindDocumentByExternalID(ctx, dbgen.FindDocumentByExternalIDParams{SourceID: r.src.ID, ExternalID: externalID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return doc, false, nil
	}
	return doc, err == nil, err
}

// store saves a new or changed page and queues it for ingestion. When the
// page would take the team past its documents or storage limit it returns
// *limitStop (and stores nothing).
func (r *run) store(ctx context.Context, final string, pg crawl.Page, digest string, known dbgen.Document, found bool) error {
	s := r.s
	docID := uuid.New()
	if found {
		docID = known.ID
	}
	key := ingest.NewOriginalKey(r.src.TeamID, r.src.ID, docID)
	if err := s.Blob.Put(ctx, key, bytes.NewReader(pg.Body), int64(len(pg.Body)), pg.ContentType); err != nil {
		return err
	}
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if r.src.TeamID.Valid && s.Limits != nil {
			team := r.src.TeamID.UUID
			need := limits.Need{Bytes: int64(len(pg.Body))}
			if found {
				need.Bytes -= known.SizeBytes
			} else {
				need.Documents = 1
			}
			if err := s.Limits.LockUsage(ctx, q, team); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, team, need); err != nil {
				var le *limits.Error
				if errors.As(err, &le) {
					return &limitStop{reason: truncatedReason(le.Def.Key)}
				}
				return err
			}
		}
		if _, err := q.UpsertWebDocument(ctx, dbgen.UpsertWebDocumentParams{
			ID: docID, SourceID: r.src.ID, TeamID: r.src.TeamID, ExternalID: final, URL: final,
			ContentType: pg.ContentType, SizeBytes: int64(len(pg.Body)), Sha256: digest, BlobKey: key,
			HttpEtag: pg.ETag, HttpLastModified: pg.LastModified, CrawlID: uuid.NullUUID{UUID: r.crawl.ID, Valid: true},
			Tags: r.cfg.Tags,
		}); err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	if err != nil {
		_ = s.Blob.Delete(context.WithoutCancel(ctx), key)
		return err
	}
	if found && known.BlobKey != "" && known.BlobKey != key {
		s.deletePrefix(ctx, strings.TrimSuffix(known.BlobKey, "original"))
	}
	return nil
}

// follow adds in-scope links of an HTML page at depth+1.
func (r *run) follow(ctx context.Context, body []byte, pageURL string, depth int, c *counts) error {
	if r.cfg.Mode != ModeCrawl || depth+1 > r.cfg.MaxDepth {
		return nil
	}
	var urls []string
	for _, link := range crawl.Links(body, pageURL) {
		if len(link) > MaxURLBytes {
			continue
		}
		if ok, _ := r.scope.Allows(link, depth+1); ok {
			urls = append(urls, link)
		}
	}
	n, err := r.add(ctx, urls, depth+1)
	c.discovered += n
	return err
}

// followStored follows the links of the stored version of an unchanged (or
// temporarily unavailable) HTML page, so its children are still seen.
func (r *run) followStored(ctx context.Context, doc dbgen.Document, depth int, c *counts) error {
	if r.cfg.Mode != ModeCrawl || depth+1 > r.cfg.MaxDepth || !isHTML(doc.ContentType) || doc.BlobKey == "" {
		return nil
	}
	rc, err := r.s.Blob.Get(ctx, doc.BlobKey)
	if err != nil {
		r.s.Log.WarnContext(ctx, "stored page unavailable", "document", doc.ID, "err", err)
		return nil
	}
	defer rc.Close()
	limit := r.s.MaxBody
	if limit <= 0 {
		limit = 20 << 20
	}
	body, err := io.ReadAll(io.LimitReader(rc, limit))
	if err != nil {
		return nil
	}
	return r.follow(ctx, body, doc.URL, depth, c)
}
