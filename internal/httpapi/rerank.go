// Rerank handlers (docs/v0.4.0.md §3): the platform's rerank model and
// settings (Admin → Models), and the status editors read.

package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/rerank"
)

// rerankRoutes: the platform rerank settings and status.
func (a *api) rerankRoutes() []route {
	return []route{
		{"GET", "/v1/admin/rerank", a.admin(a.adminGetRerank)},
		{"PUT", "/v1/admin/rerank", a.admin(a.adminPutRerank)},
		{"GET", "/v1/rerank/status", a.session(a.getRerankStatus)},
	}
}

// writeRerank writes the settings with how many published agents rerank.
func (a *api) writeRerank(w http.ResponseWriter, r *http.Request, st rerank.Stored) {
	n, err := a.Rerank.AgentCount(r.Context())
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.RerankSettings{ModelId: st.ModelID, Candidates: st.Settings.Candidates,
		TimeLimitMs: st.Settings.TimeLimitMs, Agents: int(n), Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}

func (a *api) adminGetRerank(w http.ResponseWriter, r *http.Request) {
	st, err := a.Rerank.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	a.writeRerank(w, r, st)
}

func (a *api) adminPutRerank(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.RerankSettingsInput](w, r)
	if !ok {
		return
	}
	st, err := a.Rerank.Put(r.Context(), a.actor(r), rerank.Input{ModelID: in.ModelId,
		Settings: rerank.Settings{Candidates: in.Candidates, TimeLimitMs: in.TimeLimitMs}}, rev)
	if failed(w, r, err) {
		return
	}
	a.writeRerank(w, r, st)
}

func (a *api) getRerankStatus(w http.ResponseWriter, r *http.Request) {
	st, err := a.Rerank.Status(r.Context())
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.RerankStatus{Available: st.Available, DefaultTopN: st.DefaultTopN})
}

// toAPIRerankTest is a rerank model's test scores.
func toAPIRerankTest(t *catalog.RerankTest) *apitypes.RerankModelTest {
	if t == nil {
		return nil
	}
	return &apitypes.RerankModelTest{Query: catalog.RerankTestQuery, RelevantText: catalog.RerankTestRelevant,
		IrrelevantText: catalog.RerankTestIrrelevant, Relevant: t.Relevant, Irrelevant: t.Irrelevant}
}

// toAPIRetrieveRerank is how a search was reranked (nil: it wasn't).
func toAPIRetrieveRerank(info *kbs.RerankInfo) *apitypes.RetrieveRerank {
	if info == nil {
		return nil
	}
	return &apitypes.RetrieveRerank{Status: apitypes.RetrieveRerankStatus(info.Status), Candidates: info.Candidates,
		LatencyMs: info.Latency.Milliseconds()}
}
