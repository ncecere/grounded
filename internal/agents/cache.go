// The answer cache in the chat pipeline (docs/v0.4.0.md §1,
// docs/answer-cache.md): a lookup right after the limits are admitted, a
// replay of the stored answer's events on a hit, and a store of a clean
// answer at the end of a miss. internal/answercache keeps the entries.
//
// Nothing that depends on who asks enters an answer: the system prompt
// names the agent, its team and today's date (never the person), retrieval
// is the agent's (its knowledge bases and filters, not the user's), and
// MCP tools, which could act for the person, keep an answer out of the
// cache. The date is in the key of questions about relative dates.

package agents

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/answercache"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/tracing"
)

// Lookup outcomes (grounded_answer_cache_lookups_total).
const (
	cacheHit          = "hit"
	cacheMiss         = "miss"
	cacheExact        = "exact"
	cacheNear         = "near"
	cacheNoEntry      = "no_entry"
	cacheNearRejected = "near_rejected"
	cacheFollowUp     = "follow_up"
	cacheError        = "error"
)

// cachedAnswer is what an entry stores: everything the replay sends and
// records.
type cachedAnswer struct {
	Text          string            `json:"text"`
	Citations     []Citation        `json:"citations"`
	Claims        []Claim           `json:"claims,omitempty"`
	Uncited       []UncitedSentence `json:"uncited,omitempty"`
	Sources       []RetrievalHit    `json:"sources"`
	Retrieval     *RetrievalView    `json:"retrieval,omitempty"`
	CitationCheck *CitationsRecord  `json:"citationCheck,omitempty"`
	TopSimilarity float64           `json:"topSimilarity,omitempty"`
	// Suggestions are the follow-up questions sent with it (suggest.go).
	Suggestions []string `json:"suggestions,omitempty"`
}

// cacheRun is the cache's part of one answer (nil: the answer can't use
// the cache).
type cacheRun struct {
	settings    answercache.AgentSettings
	key         answercache.Key
	kbRevs      map[string]int64
	settingsRev string
	// hit is the entry served (nil: a miss, stored at the end if clean).
	hit     *cachedAnswer
	entryID uuid.UUID
	tokens  int
}

// cacheHitNow reports whether this answer is served from the cache.
func (ru *run) cacheHitNow() bool { return ru.cache != nil && ru.cache.hit != nil }

// cacheCandidate reports whether the answer may read and write the cache:
// a published agent's answer (not Try it or an evaluation) in always mode
// with knowledge bases, while the platform switch is on.
func (ru *run) cacheCandidate(ctx context.Context) bool {
	s := ru.s
	return s.Cache != nil && ru.version != nil && ru.channel != ChannelTest && ru.usageMeta == nil &&
		ru.cfg.RetrievalMode == ModeAlways && len(ru.cfg.KBs) > 0 && s.Cache.Enabled(ctx)
}

// firstQuestion: the first message of a conversation (a new one, and no
// history from a stateless caller). Only first questions read or write the
// cache (owner decision, 2026-10-01): a follow-up is always answered live,
// since no word test can tell reliably whether it leans on the conversation,
// and its answer was written with another person's earlier turns.
func (ru *run) firstQuestion() bool {
	return ru.conv == nil && len(ru.stateless) == 0
}

// lookupCache finds a stored answer for the question (sets ru.cache when the
// answer may use the cache, and its hit). Failures are misses.
func (ru *run) lookupCache(ctx context.Context) {
	if !ru.cacheCandidate(ctx) {
		return
	}
	settings, err := ru.s.Cache.AgentSettings(ctx, ru.agent.ID)
	if err != nil {
		ru.s.Log.Warn("answer cache: read the agent's settings", "err", err, "agent", ru.agent.ID)
		return
	}
	if !settings.On(ru.grant) {
		return
	}
	ctx, span := tracing.Start(ctx, "answer_cache.lookup", attribute.String("grounded.agent_id", ru.agent.ID.String()))
	result, reason := ru.findCached(ctx, settings)
	span.SetAttributes(attribute.String("grounded.cache.result", result), attribute.String("grounded.cache.reason", reason))
	tracing.End(span, nil)
	observability.AnswerCacheLookups.WithLabelValues(result, reason).Inc()
}

// findCached computes the key and looks the question up: exactly, then
// near-identical when the agent allows it.
func (ru *run) findCached(ctx context.Context, settings answercache.AgentSettings) (result, reason string) {
	if !ru.firstQuestion() {
		return cacheMiss, cacheFollowUp
	}
	c := &cacheRun{settings: settings}
	if err := ru.cacheKey(ctx, c); err != nil {
		ru.s.Log.Warn("answer cache: key", "err", err, "agent", ru.agent.ID)
		return cacheMiss, cacheError
	}
	ru.cache = c
	e, err := ru.s.Cache.Exact(ctx, c.key)
	match := cacheExact
	if err == nil && e == nil && settings.NearIdentical {
		var rejected bool
		e, rejected, err = ru.findNear(ctx, c)
		match = cacheNear
		if rejected {
			return cacheMiss, cacheNearRejected
		}
	}
	if err != nil {
		ru.s.Log.Warn("answer cache: lookup", "err", err, "agent", ru.agent.ID)
		return cacheMiss, cacheError
	}
	if e == nil {
		return cacheMiss, cacheNoEntry
	}
	var a cachedAnswer
	if err := json.Unmarshal(e.Answer, &a); err != nil || strings.TrimSpace(a.Text) == "" {
		return cacheMiss, cacheError
	}
	c.hit, c.entryID, c.tokens = &a, e.ID, e.Tokens
	return cacheHit, match
}

// findNear finds the nearest entry by the question's embedding (embedded
// once in the agent's embedding profile and kept for the search, so a miss
// doesn't embed twice) and asks SystemOne whether both ask the same.
// rejected: SystemOne said no.
func (ru *run) findNear(ctx context.Context, c *cacheRun) (*answercache.Entry, bool, error) {
	if ru.s.SystemOne == nil {
		return nil, false, nil
	}
	cl, err := ru.s.SystemOne.CacheClient(ctx)
	if err != nil || cl == nil {
		return nil, false, err
	}
	profile, ok := ru.cacheProfile()
	if !ok {
		return nil, false, nil
	}
	vec, tokens, model, err := ru.s.KBs.EmbedQuery(ctx, profile, ru.question, ru.userTag(), &ru.retr.cache)
	if err != nil {
		return nil, false, err
	}
	if tokens > 0 {
		ru.retr.mu.Lock()
		ru.retr.embedTokens[model] += tokens
		ru.retr.mu.Unlock()
	}
	e, err := ru.s.Cache.Nearest(ctx, c.key, profile, vec)
	if err != nil || e == nil {
		return nil, false, err
	}
	same, _, err := cl.SameQuestion(ctx, ru.question, e.Question)
	if err != nil || !same || ru.nearBlocked(ctx) {
		return nil, true, nil // a failed check is a miss
	}
	return e, false, nil
}

// nearBlocked checks a near-identical question with input moderation (the
// cached question passed it, but this one's words differ). The decision is
// kept, so a miss doesn't check the question twice.
func (ru *run) nearBlocked(ctx context.Context) bool {
	if err := ru.planModeration(ctx); err != nil || !ru.mod.Active(moderation.StageInput) {
		return err != nil
	}
	d := ru.mod.Check(ctx, moderation.Input{Stage: moderation.StageInput, Text: ru.question})
	ru.modIn = &d
	return d.Blocked
}

// cacheProfile is the embedding profile of the agent's question vectors:
// the lowest profile ID among its knowledge bases (as for the gap report).
func (ru *run) cacheProfile() (uuid.UUID, bool) {
	if ru.retr == nil || len(ru.retr.kbs) == 0 {
		return uuid.Nil, false
	}
	ids := make([]uuid.UUID, len(ru.retr.kbs))
	for i, kb := range ru.retr.kbs {
		ids[i] = kb.EmbeddingProfileID
	}
	return slices.MinFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) }), true
}

// cacheKey reads the knowledge bases' content revisions and the settings
// revision (the audience's moderation policy, the SystemOne and rerank
// settings; the agent's own are in its version) in one query and builds
// the key.
func (ru *run) cacheKey(ctx context.Context, c *cacheRun) error {
	var revs json.RawMessage
	var mod, s1, rr int64
	err := ru.s.Pool.QueryRow(ctx, `SELECT coalesce((SELECT jsonb_object_agg(id::text, content_revision) FROM knowledge_bases WHERE id = ANY($1)), '{}'),
		coalesce((SELECT revision FROM moderation_policies WHERE audience = $2), 1),
		coalesce((SELECT revision FROM systemone_settings), 0), coalesce((SELECT revision FROM rerank_settings), 0)`,
		ru.cfg.KBIDs(), ru.grant).Scan(&revs, &mod, &s1, &rr)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(revs, &c.kbRevs); err != nil {
		return err
	}
	ids := make([]string, 0, len(c.kbRevs))
	for id, rev := range c.kbRevs {
		ids = append(ids, id+":"+strconv.FormatInt(rev, 10))
	}
	sort.Strings(ids)
	c.settingsRev = "moderation:" + strconv.FormatInt(mod, 10) + ",systemone:" + strconv.FormatInt(s1, 10) + ",rerank:" + strconv.FormatInt(rr, 10)
	q := answercache.Normalize(ru.question)
	day := ""
	if answercache.DependsOnDay(q) {
		day = time.Now().UTC().Format(time.DateOnly)
	}
	c.key = answercache.Key{AgentID: ru.agent.ID, Question: q, Expiry: c.settings.Expiry(),
		Conditions: answercache.Hash("v1", ru.version.ID.String(), ru.grant, strings.Join(ids, ","), c.settingsRev, day)}
	return nil
}

// replayCached answers with the stored answer: the same events a live
// answer sends (retrieval, message_start, the text, message_end with the
// citations and claims, the suggestions), recorded like a live answer with no model tokens.
func (ru *run) replayCached(ctx context.Context) (Answer, error) {
	a := ru.cache.hit
	ru.citeRec = a.CitationCheck
	ru.retr.topSim = a.TopSimilarity
	if a.Retrieval != nil {
		// The step shows this person's question, never the wording of the
		// person whose answer was saved (a first question is searched as
		// it was asked, so this is what a live answer would show).
		view := *a.Retrieval
		view.Query = ru.question
		ru.firstSearch = &view
		ru.out.send(Event{"retrieval", RetrievalEvent{Query: view.Query, Hits: a.Sources, Judging: view.Judging}})
	}
	// The text arrives whole, as a buffered answer's does: clients show it
	// from its start rather than following the bottom.
	ru.out.start()
	ru.out.send(Event{"message_start", MessageStartEvent{MessageID: ru.msgID, Buffered: true}})
	ru.markFirstToken()
	ru.out.send(Event{"text_delta", DeltaEvent{Delta: a.Text}})
	ans := ru.baseAnswer()
	ans.Text, ans.StopReason, ans.Claims, ans.Uncited = a.Text, string(llm.StopReasonStop), a.Claims, a.Uncited
	if a.Citations != nil {
		ans.Citations = a.Citations
	}
	if a.Sources != nil {
		ans.Sources = a.Sources
	}
	msg := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: a.Text}}, Model: ru.model.ID, StopReason: llm.StopReasonStop}
	ru.record(ctx, &ans, &msg, nil)
	ru.sendEnd(ans)
	ru.replaySuggestions(&ans, a.Suggestions)
	observability.AnswerCacheTokensSaved.Add(float64(ru.cache.tokens))
	if err := ru.s.Cache.Hit(context.WithoutCancel(ctx), ru.cache.entryID); err != nil {
		ru.s.Log.Warn("answer cache: count a hit", "err", err, "agent", ru.agent.ID)
	}
	return ans, nil
}

// cacheMeta marks the usage events of an answer served from the cache.
func (ru *run) cacheMeta() map[string]any {
	if !ru.cacheHitNow() {
		return nil
	}
	return map[string]any{"cached": true}
}

// storeCached keeps a clean answer of a miss: passed moderation, no error,
// no refusal and nothing that the gap report counts as a failure (so a
// cached answer never hides a failed question), with sources, and no MCP
// tool call. The switches are read again (an answer takes seconds; one
// turned off meanwhile saves nothing): the agent's here, the platform's in
// the store's statement.
func (ru *run) storeCached(ctx context.Context, ans *Answer) {
	c := ru.cache
	if c == nil || c.hit != nil || !ru.cleanAnswer(ans) {
		return
	}
	ctx = context.WithoutCancel(ctx)
	if st, err := ru.s.Cache.AgentSettings(ctx, ru.agent.ID); err != nil || !st.On(ru.grant) {
		return
	}
	stored := cachedAnswer{Text: ans.Text, Citations: ans.Citations, Claims: ans.Claims, Uncited: ans.Uncited, Sources: ans.Sources,
		Retrieval: ru.firstSearch, CitationCheck: ru.citeRec, TopSimilarity: ru.retr.topSim, Suggestions: ans.Suggestions}
	raw, err := json.Marshal(stored)
	if err != nil {
		return
	}
	in := answercache.StoreInput{Key: c.key, TeamID: ru.team.ID, AgentVersionID: ru.version.ID, Audience: ru.grant,
		KBRevisions: c.kbRevs, SettingsRevision: c.settingsRev, Answer: raw, Tokens: ans.Usage.Input + ans.Usage.Output}
	if p, ok := ru.cacheProfile(); ok {
		if vec, ok := ru.retr.cache.Lookup(p, ru.question); ok {
			in.Profile, in.Vector = &p, vec
		}
	}
	if ans.Persisted {
		id := ans.MessageID
		in.SourceMessageID = &id
	}
	if in.Retention, err = ru.transcriptRetention(ctx); err == nil {
		_, err = ru.s.Cache.Store(ctx, in)
	}
	if err != nil {
		ru.s.Log.Warn("answer cache: store", "err", err, "agent", ru.agent.ID)
	}
}

// cleanAnswer reports whether an answer may be stored (it has sources:
// NoContext is false). An answer whose text has citation markers but no
// citations is never stored: its replay would show bare [n] markers.
func (ru *run) cleanAnswer(ans *Answer) bool {
	return ans.ErrorCode == "" && ans.Moderation == nil && !ans.Refused && !ans.NoContext && ans.toolCalls == 0 &&
		ans.StopReason == string(llm.StopReasonStop) && strings.TrimSpace(ans.Text) != "" && len(ru.gapSignals(ans)) == 0 &&
		(len(ans.Citations) > 0 || len(extractMarkers(ans.Text)) == 0)
}

// transcriptRetention is the transcript retention of the agent version's
// classification: anonymous visitors' for public agents (hours, 24 by
// default), signed-in people's otherwise (days; 0 when kept).
func (ru *run) transcriptRetention(ctx context.Context) (time.Duration, error) {
	var days, hours *int32
	err := ru.s.Pool.QueryRow(ctx, `SELECT l.conversation_retention_days, l.anonymous_retention_hours FROM classification_levels l
		WHERE l.rank <= $1 ORDER BY l.rank DESC LIMIT 1`, ru.version.EffectiveRank).Scan(&days, &hours)
	if err != nil {
		return 0, nil // no level: no cap beyond the expiry
	}
	switch {
	case ru.grant == authz.AudiencePublic:
		h := int32(24)
		if hours != nil {
			h = *hours
		}
		return time.Duration(h) * time.Hour, nil
	case days != nil:
		return time.Duration(*days) * 24 * time.Hour, nil
	}
	return 0, nil
}
