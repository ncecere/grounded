package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	objsearch "github.com/ncecere/grounded/internal/search"
)

// searchRoutes: the command palette's object search (session only: API
// keys have their team's lists).
func (a *api) searchRoutes() []route {
	svc := objsearch.New(a.q, a.publicSwitch)
	if a.Evaluations != nil {
		svc.EvaluationsEnabled = a.Evaluations.Enabled
	}
	return []route{
		{"GET", "/v1/search", a.session(a.searchObjects(svc))},
	}
}

// publicSwitch reports the platform's public switch (off without agents).
func (a *api) publicSwitch(ctx context.Context) (bool, error) {
	if a.Agents == nil || a.Agents.PublicEnabled == nil {
		return false, nil
	}
	return a.Agents.PublicEnabled(ctx)
}

func (a *api) searchObjects(svc *objsearch.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit := objsearch.DefaultLimit
		if raw := q.Get("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > objsearch.MaxLimit {
				httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 50")
				return
			}
			limit = n
		}
		res, err := svc.Search(r.Context(), a.actor(r), q.Get("q"), limit)
		writeList(w, r, res, err, toAPISearchResult)
	}
}

func toAPISearchResult(r objsearch.Result) apitypes.SearchResult {
	opt := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}
	out := apitypes.SearchResult{Type: apitypes.SearchResultType(r.Type), Id: r.ID, Label: r.Label, Secondary: r.Secondary,
		Kind: opt(r.Kind), Status: opt(r.Status), TeamSlug: opt(r.TeamSlug), AgentSlug: opt(r.AgentSlug)}
	if r.Type == objsearch.TypeAgent {
		out.CanOpen, out.CanChat = &r.CanOpen, &r.CanChat
	}
	return out
}
