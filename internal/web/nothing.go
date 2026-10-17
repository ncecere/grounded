package web

import (
	"context"
	"errors"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// nothingFetchedNotes say, for the reason most pages were skipped, why a run that fetched nothing did. They are the run's note in the sync
// history (a run that fetched something has none: it is not a problem that some pages were skipped).
var nothingFetchedNotes = map[string]string{
	"robots_disallowed":   "Nothing was fetched: the site's robots.txt doesn't allow it.",
	"robots_unreachable":  "Nothing was fetched: the site couldn't be reached (its robots.txt could not be read).",
	"blocked_address":     "Nothing was fetched: the address isn't a public website (only public sites on ports 80 and 443 can be crawled).",
	"host_not_allowed":    "Nothing was fetched: the host isn't on the crawl allowlist.",
	"unsupported_content": "Nothing was fetched: the pages aren't a kind Grounded can read.",
}

// nothingFetchedNote is the note of a finished run: "" unless it skipped pages and fetched none. (A page that failed counts as fetched, so a
// run with failures has no note of this kind: its failures are in the counts.)
func nothingFetchedNote(ctx context.Context, q *dbgen.Queries, cr dbgen.WebCrawl) (string, error) {
	if cr.PagesFetched != 0 || cr.PagesSkipped == 0 {
		return "", nil
	}
	reason, err := q.TopSkipReason(ctx, cr.ID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return "Nothing was fetched: every page was skipped.", nil
	} else if err != nil {
		return "", err
	}
	if note, ok := nothingFetchedNotes[reason]; ok {
		return note, nil
	}
	return "Nothing was fetched: every page was skipped.", nil
}
