// Following a page's links, and keeping them with its document so an unchanged page's links are followed without
// reading the page back from object storage (#250, migration 00072). The links kept are every link of the page a crawl
// could follow, whatever the scope: each run applies its own scope and depth.

package web

import (
	"context"
	"errors"
	"io"

	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// pageLinks are an HTML page's links a crawl could follow (never nil).
func pageLinks(body []byte, pageURL string) []string {
	out := []string{}
	for _, link := range crawl.Links(body, pageURL) {
		if len(link) <= MaxURLBytes {
			out = append(out, link)
		}
	}
	return out
}

// followLinks adds the links in scope at depth+1.
func (r *run) followLinks(ctx context.Context, links []string, depth int, c *counts) error {
	if r.cfg.Mode != ModeCrawl || depth+1 > r.cfg.MaxDepth {
		return nil
	}
	var urls []string
	for _, link := range links {
		if ok, _ := r.scope.Allows(link, depth+1); ok {
			urls = append(urls, link)
		}
	}
	n, err := r.add(ctx, urls, depth+1)
	c.discovered += n
	return err
}

// followFetched follows a fetched HTML page's links and keeps them with the page's stored version (digest).
func (r *run) followFetched(ctx context.Context, body []byte, final, digest string, depth int, c *counts) error {
	links := pageLinks(body, final)
	r.saveLinks(ctx, final, digest, links)
	return r.followLinks(ctx, links, depth, c)
}

// saveLinks keeps a page's links for its stored version. A failure only costs reading the page back on a later sync.
func (r *run) saveLinks(ctx context.Context, externalID, digest string, links []string) {
	if err := r.s.q.SaveWebPageLinks(ctx, dbgen.SaveWebPageLinksParams{Links: links, SourceID: r.src.ID, ExternalID: externalID, Sha256: digest}); err != nil {
		r.s.Log.WarnContext(ctx, "could not keep a page's links", "url", externalID, "err", err)
	}
}

// followStored follows the links of the stored version of an unchanged (or
// temporarily unavailable) HTML page, so its children are still seen: the
// links kept with it, or, for a page stored without them, the page read back
// from object storage (which keeps them for the next time).
func (r *run) followStored(ctx context.Context, doc dbgen.Document, depth int, c *counts) error {
	if r.cfg.Mode != ModeCrawl || depth+1 > r.cfg.MaxDepth || !isHTML(doc.ContentType) || doc.BlobKey == "" {
		return nil
	}
	links, err := r.s.q.StoredWebPageLinks(ctx, dbgen.StoredWebPageLinksParams{DocumentID: doc.ID, Sha256: doc.Sha256})
	if err == nil {
		return r.followLinks(ctx, links, depth, c)
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return err
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
	links = pageLinks(body, doc.URL)
	r.saveLinks(ctx, doc.ExternalID, doc.Sha256, links)
	return r.followLinks(ctx, links, depth, c)
}
