// The source viewer (docs/v0.4.0.md §5): cited passages in context for the
// answer's reader (signed in or anonymous) and whole documents for the
// team's editors, admins and owners.

package httpapi

import (
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/sources"
)

// citationNumber reads the {n} path value (1-999).
func citationNumber(w http.ResponseWriter, r *http.Request) (int, bool) {
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 || n > 999 {
		httpx.Error(w, http.StatusBadRequest, "invalid_number", "The source number must be between 1 and 999")
		return 0, false
	}
	return n, true
}

func (a *api) getCitedPassage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "messageId")
	if !ok {
		return
	}
	n, ok := citationNumber(w, r)
	if !ok {
		return
	}
	p, err := a.Agents.CitedPassage(r.Context(), a.actor(r), id, n)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICitedPassage(p))
}

func (a *api) getPublicCitedPassage(w http.ResponseWriter, r *http.Request) {
	agentID, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "messageId")
	if !ok {
		return
	}
	n, ok := citationNumber(w, r)
	if !ok {
		return
	}
	if _, err := a.Agents.PublicProfile(r.Context(), agentID.String()); failed(w, r, err) {
		return
	}
	sess, ok := a.resume(w, r, agentID)
	if !ok {
		return
	}
	p, err := a.Agents.PublicCitedPassage(r.Context(), sess.ID, agentID, id, n)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICitedPassage(p))
}

func toAPICitedPassage(p agents.CitedPassage) apitypes.CitedPassage {
	c := p.Citation
	hp := p.HeadingPath
	if hp == nil {
		hp = []string{}
	}
	out := apitypes.CitedPassage{
		N: c.N, Status: apitypes.CitedPassageStatus(p.Status), DocumentId: c.DocumentID, SourceId: c.SourceID, Title: c.Title,
		HeadingPath: hp, Passages: toAPIContextPassages(p.Passages), Claims: viaJSON[[]apitypes.Claim](p.Claims),
		Url: optString(c.URL), Filename: optString(c.Filename), DocumentTeam: optString(p.DocumentTeam),
	}
	if out.Claims == nil {
		out.Claims = []apitypes.Claim{}
	}
	return out
}

func toAPIContextPassages(ps []sources.ContextPassage) []apitypes.ContextPassage {
	out := make([]apitypes.ContextPassage, len(ps))
	for i, p := range ps {
		out[i] = apitypes.ContextPassage{Ordinal: p.Ordinal, Content: p.Content, HeadingPath: p.HeadingPath, PageStart: p.PageStart,
			PageEnd: p.PageEnd, Cited: p.Cited}
	}
	return out
}

// optString is nil for "".
func optString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// getDocumentText serves a document's passages to the team's editors,
// admins and owners: ?around= a passage in context, else ?from= and ?limit=.
func (a *api) getDocumentText(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, docID, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		tq, ok := documentTextQuery(w, r)
		if !ok {
			return
		}
		t, err := a.Sources.DocumentText(r.Context(), a.actor(r), owner(r), src, docID, tq)
		if failed(w, r, err) {
			return
		}
		d := t.Document
		out := apitypes.DocumentText{DocumentId: d.ID, SourceId: d.SourceID, Title: d.Title, Kind: d.Kind, Items: toAPIContextPassages(t.Items),
			Total: d.ChunkCount, From: tq.From, Url: optString(d.URL), Filename: optString(d.Filename)}
		if len(t.Items) > 0 {
			out.From = t.Items[0].Ordinal
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

// documentTextQuery reads ?from= (≥ 0), ?limit= (1-200, default 50) and ?around=.
func documentTextQuery(w http.ResponseWriter, r *http.Request) (sources.DocumentTextQuery, bool) {
	tq := sources.DocumentTextQuery{Limit: 50}
	q := r.URL.Query()
	if raw := q.Get("from"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 1_000_000 {
			httpx.Error(w, http.StatusBadRequest, "invalid_from", "from must be 0 or more")
			return tq, false
		}
		tq.From = int32(n)
	}
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 200 {
			httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 200")
			return tq, false
		}
		tq.Limit = int32(n)
	}
	if raw := q.Get("around"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid around")
			return tq, false
		}
		tq.Around = &id
	}
	return tq, true
}
