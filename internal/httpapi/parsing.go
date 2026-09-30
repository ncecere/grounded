// Parsing handlers (docs/ocr.md §6): Admin -> Parsing's settings and Test
// button, the OCR record on documents, and retrying a source's documents
// by error code.

package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/ocr"
)

// parsingRoutes: Admin -> Parsing.
func (a *api) parsingRoutes() []route {
	return []route{
		{"GET", "/v1/admin/parsing", a.admin(a.adminGetParsing)},
		{"PUT", "/v1/admin/parsing", a.admin(a.adminPutParsing)},
		{"POST", "/v1/admin/parsing/test", a.admin(a.adminTestParsing)},
	}
}

func (a *api) toAPIParsing(r *http.Request, st ocr.Stored) (apitypes.ParsingSettings, error) {
	counts, err := a.OCR.NeedsOCR(r.Context(), a.actor(r))
	if err != nil {
		return apitypes.ParsingSettings{}, err
	}
	out := apitypes.ParsingSettings{
		OcrEnabled: st.Enabled, Backend: apitypes.OcrBackend(st.Backend), VisionModelId: st.VisionModelID, Languages: st.Languages,
		MaxPagesPerDocument: int32(a.OCR.Config.MaxPagesPerDocument), Concurrency: int32(a.OCR.Config.Concurrency),
		Revision: st.Revision, UpdatedAt: st.UpdatedAt, Backends: []apitypes.OcrBackendStatus{}, NeedsOcr: []apitypes.NeedsOcrCount{},
	}
	for _, b := range a.OCR.BackendStatuses() {
		out.Backends = append(out.Backends, apitypes.OcrBackendStatus{Backend: apitypes.OcrBackend(b.Backend), Configured: b.Configured, ConfiguredBy: b.ConfigKey})
	}
	for _, c := range counts {
		n := apitypes.NeedsOcrCount{TeamSlug: c.TeamSlug, TeamName: c.TeamName, Documents: c.Documents}
		if c.TeamID.Valid {
			id := c.TeamID.UUID
			n.TeamId = &id
		}
		out.NeedsOcr = append(out.NeedsOcr, n)
	}
	return out, nil
}

func (a *api) adminGetParsing(w http.ResponseWriter, r *http.Request) {
	st, err := a.OCR.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out, err := a.toAPIParsing(r, st)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, out)
}

func (a *api) adminPutParsing(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.ParsingSettingsInput](w, r)
	if !ok {
		return
	}
	st, err := a.OCR.Put(r.Context(), a.actor(r), ocr.Settings{Enabled: in.OcrEnabled, Backend: string(in.Backend),
		VisionModelID: in.VisionModelId, Languages: in.Languages}, rev)
	if failed(w, r, err) {
		return
	}
	out, err := a.toAPIParsing(r, st)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, out)
}

func (a *api) adminTestParsing(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ParsingTestInput
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	test := ocr.TestInput{VisionModelID: in.VisionModelId}
	if in.Backend != nil {
		test.Backend = string(*in.Backend)
	}
	if in.Languages != nil {
		test.Languages = *in.Languages
	}
	res, err := a.OCR.Test(r.Context(), a.actor(r), test)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ParsingTestResult{Ok: res.OK, Backend: apitypes.OcrBackend(res.Backend), Text: res.Text, Expected: ocr.SampleText,
		Confidence: res.Confidence, LatencyMs: res.Latency.Milliseconds(), TokensIn: int32(res.TokensIn), TokensOut: int32(res.TokensOut)}
	if res.Error != "" {
		out.Error = &res.Error
	}
	httpx.JSON(w, http.StatusOK, out)
}

// documentOCR reads a document's OCR record (metadata.ocr).
func documentOCR(meta json.RawMessage) *apitypes.DocumentOcr {
	var m struct {
		OCR *struct {
			Backend string  `json:"backend"`
			Pages   []int32 `json:"pages"`
		} `json:"ocr"`
	}
	if json.Unmarshal(meta, &m) != nil || m.OCR == nil || len(m.OCR.Pages) == 0 {
		return nil
	}
	return &apitypes.DocumentOcr{Backend: apitypes.OcrBackend(m.OCR.Backend), Pages: m.OCR.Pages}
}

// retryDocuments queues a source's documents with one error code again.
func (a *api) retryDocuments(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		var in apitypes.DocumentRetryInput
		if !httpx.Decode(w, r, &in) {
			return
		}
		n, err := a.Sources.RetryDocuments(r.Context(), a.actor(r), owner(r), id, string(in.ErrorCode))
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, apitypes.DocumentRetryResult{Retried: int32(n)})
	}
}

// testVisionModel is "Test model" for a vision model: it transcribes the
// built-in sample page, as Admin -> Parsing's Test button does.
func (a *api) testVisionModel(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	res, err := a.OCR.Test(r.Context(), a.actor(r), ocr.TestInput{Backend: ocr.BackendVision, VisionModelID: &id})
	if failed(w, r, err) {
		return
	}
	out := apitypes.ModelTestResult{Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Timings: probeTimings(r)}
	if res.OK {
		out.Reply = &res.Text
		out.Usage = &apitypes.TokenUsage{PromptTokens: res.TokensIn, CompletionTokens: res.TokensOut, TotalTokens: res.TokensIn + res.TokensOut}
	} else {
		out.Error = &apitypes.ProxyError{Kind: "unavailable", Message: res.Error}
	}
	a.writeModelTest(w, r, id, out)
}
