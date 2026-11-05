package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// piiRoutes: Admin -> Personal data (B7, docs/pii-scanning.md). The document reviews are with the document routes.
func (a *api) piiRoutes() []route {
	return []route{
		{"GET", "/v1/admin/pii", a.admin(a.adminGetPii)},
		{"PUT", "/v1/admin/pii", a.admin(a.adminPutPii)},
	}
}

func (a *api) adminGetPii(w http.ResponseWriter, r *http.Request) {
	st, err := a.PII.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	a.writePii(w, r, st)
}

func (a *api) adminPutPii(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.PiiSettingsInput](w, r)
	if !ok {
		return
	}
	set := pii.Settings{Enabled: in.Enabled, BlockLevels: in.BlockLevels, Patterns: make([]pii.PatternInput, len(in.Patterns))}
	for i, p := range in.Patterns {
		set.Patterns[i] = pii.PatternInput{Name: p.Name, Pattern: p.Pattern}
	}
	st, err := a.PII.Update(r.Context(), a.actor(r), set, rev)
	if failed(w, r, err) {
		return
	}
	a.writePii(w, r, st)
}

func (a *api) writePii(w http.ResponseWriter, r *http.Request, st pii.Settings) {
	rows, err := dbgen.New(a.PII.Pool).CountPIIReviewByTeam(r.Context())
	if failed(w, r, err) {
		return
	}
	out := apitypes.PiiSettings{Enabled: st.Enabled, BlockLevels: st.BlockLevels, Patterns: make([]apitypes.PiiPattern, len(st.Patterns)),
		Revision: st.Revision, UpdatedAt: st.UpdatedAt, Review: make([]apitypes.PiiReviewCount, len(rows))}
	for i, p := range st.Patterns {
		out.Patterns[i] = apitypes.PiiPattern{Name: p.Name, Pattern: p.Pattern}
	}
	for i, row := range rows {
		out.Review[i] = apitypes.PiiReviewCount{Team: row.Slug, TeamName: row.Name, Held: row.Held, Flagged: row.Flagged}
	}
	writeRevised(w, http.StatusOK, st.Revision, out)
}

// reviewDocumentPii dismisses or approves a document's possible personal data (editors; platform admins for shared
// sources).
func (a *api) reviewDocumentPii(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, doc, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		var in apitypes.DocumentPiiReviewInput
		if !httpx.Decode(w, r, &in) {
			return
		}
		d, err := a.Sources.ReviewPII(r.Context(), a.actor(r), owner(r), src, doc, string(in.Action))
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, toAPIDocument(d))
	}
}

// documentPII is a document's findings and review (nil when it has none).
func documentPII(meta json.RawMessage) *apitypes.DocumentPii {
	rec := pii.FromMetadata(meta)
	if rec == nil {
		return nil
	}
	out := &apitypes.DocumentPii{State: apitypes.DocumentPiiState(rec.State), Findings: make([]apitypes.PiiFinding, len(rec.Findings)), ReviewedAt: rec.ReviewedAt}
	for i, f := range rec.Findings {
		pages := make([]int32, len(f.Pages))
		for j, p := range f.Pages {
			pages[j] = int32(p)
		}
		out.Findings[i] = apitypes.PiiFinding{Kind: f.Kind, Count: int32(f.Count), Pages: pages}
	}
	return out
}
