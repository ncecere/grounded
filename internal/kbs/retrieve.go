package kbs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/tags"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// Query is a retrieval request.
type Query struct {
	Text   string
	TopK   int // 0 = the KB's default
	Filter MetadataFilter
	// Judge judges the platform's candidate count of fused hits with the
	// SystemOne model (team editors; the KB playground). TopK is ignored.
	Judge bool
}

// Hit is one retrieved chunk with its citation.
type Hit struct {
	ChunkID     uuid.UUID
	DocumentID  uuid.UUID
	SourceID    uuid.UUID
	KBID        uuid.UUID
	Content     string
	HeadingPath []string
	PageStart   int32
	PageEnd     int32
	Title       string
	Filename    string
	URL         string
	Score       float64 // RRF score; higher is better
	VectorRank  int     // 1-based rank in vector results, 0 if absent
	LexicalRank int     // 1-based rank in full-text results, 0 if absent
	// Distance is the cosine distance between the query and the chunk's
	// vector (-1 when the chunk has no vector). Similarity = 1 - Distance.
	Distance float64
}

// Similarity is 1 - cosine distance, or 0 when unknown.
func (h Hit) Similarity() float64 {
	if h.Distance < 0 {
		return 0
	}
	return 1 - h.Distance
}

// Result is a retrieval response.
type Result struct {
	Hits    []Hit
	Latency time.Duration
	// Judging is set when the query asked for judging.
	Judging *Judging
}

// ErrModelUnavailable is returned when the embedding model cannot be reached.
var ErrModelUnavailable = apperr.New(503, "model_unavailable", "The embedding model is unavailable. Try again shortly.")

// ---- metadata filters -------------------------------------------------------

// MetadataFilter restricts retrieval by document metadata
// (docs/phase3-agents.md §3). The JSON form is used by /retrieve and by agent
// configurations.
type MetadataFilter struct {
	// SourceIDs is intersected with the knowledge base's sources.
	SourceIDs []uuid.UUID `json:"sourceIds,omitempty"`
	// Kinds are document kinds: pdf, docx, pptx, html, markdown (md), text (txt).
	Kinds []string `json:"kinds,omitempty"`
	// Tags match documents with any of them.
	Tags []string `json:"tags,omitempty"`
	// URLPrefixes match web pages whose URL starts with any of them.
	URLPrefixes   []string   `json:"urlPrefixes,omitempty"`
	UpdatedAfter  *time.Time `json:"updatedAfter,omitempty"`
	UpdatedBefore *time.Time `json:"updatedBefore,omitempty"`
}

// IsZero reports whether the filter matches everything.
func (f MetadataFilter) IsZero() bool {
	return len(f.SourceIDs) == 0 && f.docs().IsZero()
}

func (f MetadataFilter) docs() vectorstore.DocFilter {
	return vectorstore.DocFilter{Kinds: f.Kinds, Tags: f.Tags, URLPrefixes: f.URLPrefixes, UpdatedAfter: f.UpdatedAfter, UpdatedBefore: f.UpdatedBefore}
}

var kindAliases = map[string]string{
	"pdf": "pdf", "docx": "docx", "pptx": "pptx", "html": "html", "htm": "html",
	"markdown": "markdown", "md": "markdown", "text": "text", "txt": "text",
}

const maxFilterLen = 50

// Normalize validates a filter and returns its canonical form. Problems are
// reported with the field name for agent validation.
func (f MetadataFilter) Normalize() (MetadataFilter, error) {
	bad := func(field, msg string) error {
		return &apperr.Error{Status: 400, Code: "invalid_filter", Message: msg, Details: map[string]any{"field": field}}
	}
	out := MetadataFilter{UpdatedAfter: f.UpdatedAfter, UpdatedBefore: f.UpdatedBefore}
	if len(f.SourceIDs) > maxFilterLen || len(f.Kinds) > maxFilterLen || len(f.Tags) > maxFilterLen || len(f.URLPrefixes) > maxFilterLen {
		return out, bad("filters", fmt.Sprintf("Each filter list can have at most %d entries", maxFilterLen))
	}
	seenSrc := map[uuid.UUID]bool{}
	for _, id := range f.SourceIDs {
		if !seenSrc[id] {
			seenSrc[id] = true
			out.SourceIDs = append(out.SourceIDs, id)
		}
	}
	var ok bool
	if out.Kinds, ok = normalizeKinds(f.Kinds); !ok {
		return out, bad("filters.kinds", "Kinds must be pdf, docx, pptx, html, md or txt")
	}
	for _, t := range f.Tags {
		tag, ok := tags.One(t)
		if !ok {
			return out, bad("filters.tags", fmt.Sprintf("Tags must be 1-%d characters without commas", tags.MaxLength))
		}
		out.Tags = append(out.Tags, tag)
	}
	for _, p := range f.URLPrefixes {
		p = strings.TrimSpace(p)
		if !isURLPrefix(p) {
			return out, bad("filters.urlPrefixes", "URL prefixes must be http(s) URLs such as https://www.example.edu/admissions/")
		}
		out.URLPrefixes = append(out.URLPrefixes, p)
	}
	if f.UpdatedAfter != nil && f.UpdatedBefore != nil && !f.UpdatedAfter.Before(*f.UpdatedBefore) {
		return out, bad("filters.updatedBefore", "updatedBefore must be after updatedAfter")
	}
	return out, nil
}

// normalizeKinds maps kind aliases to kinds, once each; ok is false for an
// unknown kind.
func normalizeKinds(in []string) (kinds []string, ok bool) {
	seen := map[string]bool{}
	for _, k := range in {
		kind, ok := kindAliases[strings.ToLower(strings.TrimSpace(k))]
		if !ok {
			return nil, false
		}
		if !seen[kind] {
			seen[kind] = true
			kinds = append(kinds, kind)
		}
	}
	return kinds, true
}

// isURLPrefix accepts an http(s) URL of at most 2048 bytes.
func isURLPrefix(p string) bool {
	u, err := url.Parse(p)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && len(p) <= 2048
}

// Retrieve runs hybrid search for a team member or an API key with the query
// scope limited to this KB, with team query limits and usage.
func (s *Service) Retrieve(ctx context.Context, a authz.Actor, teamRef string, kbID uuid.UUID, in Query) (Result, error) {
	start := time.Now()
	if a.Key != nil && !a.Key.HasScope(authz.ScopeQuery) {
		return Result{}, apperr.Forbidden("This API key does not have the query scope")
	}
	text := strings.TrimSpace(in.Text)
	if text == "" || len(text) > 4000 {
		return Result{}, apperr.Invalid("invalid_query", "The query must be 1-4000 characters")
	}
	filter, err := in.Filter.Normalize()
	if err != nil {
		return Result{}, err
	}
	kb, err := s.Get(ctx, a, teamRef, kbID)
	if err != nil {
		return Result{}, err
	}
	if err := s.checkDirectRetrieve(ctx, a, kb); err != nil {
		return Result{}, err
	}
	var plan *systemone.JudgePlan
	if in.Judge {
		if plan, err = s.judgePlan(ctx, a, teamRef); err != nil {
			return Result{}, err
		}
	}
	k := int(kb.TopK)
	if in.TopK > 0 {
		k = min(in.TopK, 50)
	}
	if plan != nil {
		k = plan.Candidates
	}
	return s.retrieve(ctx, a, kb, retrieval{text: text, k: k, filter: filter, plan: plan}, start)
}

// retrieval is one search of a knowledge base: k results (or the judging
// plan's candidates), with the usage metadata to add.
type retrieval struct {
	text   string
	k      int
	filter MetadataFilter
	plan   *systemone.JudgePlan
	meta   map[string]any
}

// retrieve applies the team's query limits, searches, judges when asked and
// records the query's usage.
func (s *Service) retrieve(ctx context.Context, a authz.Actor, kb KB, r retrieval, start time.Time) (Result, error) {
	// Team query limits: per day (usage ledger), per minute (Valkey).
	if s.Limits != nil {
		if err := s.Limits.CheckQuery(ctx, kb.TeamID, a); err != nil {
			return Result{}, err
		}
	}
	res, err := s.Search(ctx, kb, SearchParams{Text: r.text, TopK: r.k, Filter: r.filter, User: "grounded-query:" + kb.TeamID.String()})
	if err != nil {
		return Result{}, err
	}
	out := Result{Hits: res.Hits}
	meter := &systemone.Meter{}
	if r.plan != nil {
		out.Hits, out.Judging = judgeHits(systemone.WithMeter(ctx, meter), r.plan, r.text, res.Hits)
	}
	// Every retrieve is a query (even on an empty KB): it counts towards the
	// team's usage and limits.
	var extra []dbgen.InsertUsageParams
	if res.EmbedTokens > 0 {
		extra = append(extra, dbgen.InsertUsageParams{
			Kind: "embed_tokens", Quantity: int64(res.EmbedTokens),
			ModelID: uuid.NullUUID{UUID: res.EmbedModelID, Valid: true}, Metadata: json.RawMessage(`{}`),
		})
	}
	extra = append(extra, meterUsage(meter)...)
	if err := s.recordUsage(ctx, a, kb, len(res.Hits), extra, r.meta); err != nil {
		return Result{}, err
	}
	out.Latency = time.Since(start)
	return out, nil
}

// RetrieveForEvaluation runs a knowledge base's own retrieval for an
// evaluation question (docs/evaluations.md §2): the KB's top-k, under the
// team's query limits, recorded as query usage with meta (source:
// evaluation). The caller has checked access; kb comes from ResolveKBs.
func (s *Service) RetrieveForEvaluation(ctx context.Context, a authz.Actor, kb KB, text string, meta map[string]any) (Result, error) {
	return s.retrieve(ctx, a, kb, retrieval{text: strings.TrimSpace(text), k: int(kb.TopK), meta: meta}, time.Now())
}

// recordUsage writes the query (and, when embedded, its embedding tokens) to
// the usage ledger; the daily query limit counts these rows. meta is added to
// every event's metadata.
func (s *Service) recordUsage(ctx context.Context, a authz.Actor, kb KB, hits int, extra []dbgen.InsertUsageParams, meta map[string]any) error {
	query, _ := json.Marshal(map[string]any{"hits": hits})
	usage := append([]dbgen.InsertUsageParams{{Kind: "query", Quantity: 1, Metadata: query}}, extra...)
	for _, u := range usage {
		u.TeamID, u.KBID = uuid.NullUUID{UUID: kb.TeamID, Valid: true}, uuid.NullUUID{UUID: kb.ID, Valid: true}
		u.UserID = uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
		if a.Key != nil {
			u.APIKeyID = uuid.NullUUID{UUID: a.Key.ID, Valid: true}
		}
		u.Metadata = TagMetadata(u.Metadata, meta)
		if err := s.q.InsertUsage(ctx, u); err != nil {
			return err
		}
	}
	s.Limits.Recorded(kb.TeamID, usage)
	return nil
}

// TagMetadata adds meta to a usage event's JSON metadata (unchanged when
// meta is empty).
func TagMetadata(raw json.RawMessage, meta map[string]any) json.RawMessage {
	if len(meta) == 0 {
		return raw
	}
	m := map[string]any{}
	_ = json.Unmarshal(raw, &m)
	for k, v := range meta {
		m[k] = v
	}
	out, _ := json.Marshal(m)
	return out
}

// ResolveKBs loads KBs with their sources without permission checks: the
// caller must already hold a grant (an agent version). Missing KBs are
// omitted.
func (s *Service) ResolveKBs(ctx context.Context, ids []uuid.UUID) ([]KB, error) {
	var kbs []dbgen.KnowledgeBase
	for _, id := range ids {
		kb, err := s.q.GetKB(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, err
		}
		kbs = append(kbs, kb)
	}
	return s.withSources(ctx, s.q, kbs)
}

// vectorCount estimates how many vectors a KB's sources hold (from document
// chunk counts), cached briefly so each query does not re-aggregate.
func (s *Service) vectorCount(ctx context.Context, kbID uuid.UUID, sourceIDs []uuid.UUID) (int64, error) {
	s.countMu.Lock()
	c, ok := s.counts[kbID]
	s.countMu.Unlock()
	if ok && time.Since(c.at) < time.Minute && c.sources == len(sourceIDs) {
		return c.n, nil
	}
	rows, err := s.q.SourceDocumentStats(ctx, sourceIDs)
	if err != nil {
		return 0, err
	}
	var n int64
	for _, r := range rows {
		n += r.Chunks
	}
	s.countMu.Lock()
	if s.counts == nil {
		s.counts = map[uuid.UUID]cachedCount{}
	}
	s.counts[kbID] = cachedCount{n: n, at: time.Now(), sources: len(sourceIDs)}
	s.countMu.Unlock()
	return n, nil
}

type cachedCount struct {
	n       int64
	at      time.Time
	sources int
}

// checkDirectRetrieve refuses an API key's /retrieve on a knowledge base
// whose classification level doesn't allow direct retrieval (DESIGN.md §4).
// People in the app and agents are unaffected.
func (s *Service) checkDirectRetrieve(ctx context.Context, a authz.Actor, kb KB) error {
	if a.Key == nil || kb.EffectiveClassification == "" {
		return nil
	}
	level, err := s.q.GetClassification(ctx, kb.EffectiveClassification)
	if err != nil {
		return err
	}
	if !level.DirectRetrieve {
		return &apperr.Error{Status: 403, Code: "direct_retrieve_not_allowed",
			Message: fmt.Sprintf("API keys can't retrieve from %s knowledge bases directly; use an agent", level.Name)}
	}
	return nil
}
