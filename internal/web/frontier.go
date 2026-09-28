// The crawl frontier: seeding a run and adding discovered URLs.

package web

import (
	"context"
	"net/url"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// add inserts URLs at depth, bounded by the frontier cap (maxPages × 5).
func (r *run) add(ctx context.Context, urls []string, depth int) (int32, error) {
	limit := int64(r.cfg.MaxPages)*5 - r.frontier
	if limit <= 0 || len(urls) == 0 {
		return 0, nil
	}
	if int64(len(urls)) > limit {
		urls = urls[:limit]
	}
	n, err := r.s.q.InsertFrontier(ctx, dbgen.InsertFrontierParams{CrawlID: r.crawl.ID, Depth: int32(depth), Urls: urls})
	r.frontier += n
	return int32(n), err
}

// seed inserts the configured URLs (depth 0) and, in crawl mode with
// useSitemaps, in-scope sitemap URLs of each seed origin (depth 1).
func (r *run) seed(ctx context.Context) error {
	n, err := r.add(ctx, r.cfg.URLs, 0)
	if err != nil {
		return err
	}
	if r.cfg.Mode == ModeCrawl && r.cfg.UseSitemaps && r.cfg.MaxDepth >= 1 {
		seen := map[string]bool{}
		var found []string
		for _, seed := range r.cfg.URLs {
			origin := originOf(seed)
			if seen[origin] || len(found) >= r.cfg.MaxPages {
				continue
			}
			seen[origin] = true
			urls, err := r.s.Fetcher.Sitemaps(ctx, origin, r.cfg.MaxPages)
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				r.s.Log.InfoContext(ctx, "sitemap discovery failed", "crawl", r.crawl.ID, "origin", origin, "err", err)
			}
			for _, u := range urls {
				if len(found) >= r.cfg.MaxPages {
					break
				}
				if ok, _ := r.scope.Allows(u, 1); ok && len(u) <= MaxURLBytes {
					found = append(found, u)
				}
			}
		}
		m, err := r.add(ctx, found, 1)
		if err != nil {
			return err
		}
		n += m
	}
	return r.s.q.AddCrawlCounts(ctx, dbgen.AddCrawlCountsParams{ID: r.crawl.ID, Discovered: n})
}

func originOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return u.Scheme + "://" + u.Host + "/"
}
