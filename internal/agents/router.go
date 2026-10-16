// Router agents (docs/specs/v0.6.0/DESIGN.md §4): an agent with router set answers nothing itself. Each question goes
// to the best agent the asker may chat with whose team made it reachable (Routable), chosen by one SystemOne
// request; the target answers in the asker's own conversation with it (so the target's limits, moderation,
// citations and analytics all apply), and the router shows that answer, names the agent and links to the
// conversation. When nothing fits, the router refuses and the question is a gap of the router's.

package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// MaxRouteCandidates bounds the agents one routing request describes to the model.
const MaxRouteCandidates = 25

// Routing outcomes beyond the SystemOne decisions.
const (
	// RoutingUnavailable: routing could not run (the SystemOne scope check is off or failed).
	RoutingUnavailable = "unavailable"
	// NoContextNoAgent and NoContextRouteUnavailable are the no-context reasons of a router's refusals.
	NoContextNoAgent          = "no_agent"
	NoContextRouteUnavailable = "route_unavailable"
	// GapNoAgent: the question fits no agent the router may send it to.
	GapNoAgent = "no_agent"
)

// errRouterNeedsConversation: a router sends each question on in the asker's own conversation, which a service key, the
// OpenAI-compatible endpoint and the editor's test chat do not have.
var errRouterNeedsConversation = apperr.Invalid("router_needs_conversation",
	"A router answers in a conversation of a person or a visitor. Ask it from its page, or ask the agent it would route to")

// DefaultNoAgent is what a router says when nothing fits and its refusal message is still the default.
const DefaultNoAgent = "I couldn't find an assistant here that covers that. Try asking it another way, or ask the people who run this service."

// routeUnavailableMessage is what a router says when it cannot choose.
const routeUnavailableMessage = "I can't send your question to the right assistant just now. Please try again later."

// RoutingRecord is the content-free record of a router's turn (message_events.routing).
type RoutingRecord struct {
	Decision       string     `json:"decision"`
	Confidence     float64    `json:"confidence,omitempty"`
	Candidates     int        `json:"candidates"`
	AgentID        *uuid.UUID `json:"agentId,omitempty"`
	ConversationID *uuid.UUID `json:"conversationId,omitempty"`
	LatencyMs      int64      `json:"latencyMs"`
}

func (ru *run) routingJSON() json.RawMessage {
	if ru.routeRec == nil {
		return nil
	}
	b, _ := json.Marshal(ru.routeRec)
	return b
}

// routeGapSignals: a routed question is the target's to count (its own answer recorded it); one that fits nothing is
// the router's gap; one that could not be routed says nothing about anyone's knowledge.
func (ru *run) routeGapSignals(ans *Answer) []string {
	if ans.ErrorCode == "" && ru.routeRec.Decision == systemone.RouteNone {
		return []string{GapNoAgent}
	}
	return nil
}

// routeAnswer is the router's whole answer. It replaces moderation, retrieval and the agent loop.
func (ru *run) routeAnswer(ctx context.Context) (Answer, error) {
	rec := &RoutingRecord{Decision: RoutingUnavailable}
	ru.routeRec = rec
	if ru.scope == nil { // the SystemOne scope check is off (or its settings failed): nothing to choose with
		return ru.refuseRouter(ctx, NoContextRouteUnavailable)
	}
	cards := ru.routeCandidates(ctx)
	rec.Candidates = len(cards)
	if len(cards) == 0 {
		rec.Decision = systemone.RouteNone
		return ru.refuseRouter(ctx, NoContextNoAgent)
	}
	agents := make([]systemone.RouteAgent, len(cards))
	for i, c := range cards {
		agents[i] = systemone.RouteAgent{Key: fmt.Sprintf("agent_%d", i+1), Name: c.Agent.Name, Team: c.TeamName,
			Description: c.Agent.Description, Subject: c.Subject}
	}
	res := ru.scope.Client.Route(ctx, systemone.RouteState{Message: ru.question, PreviousMessage: ru.previousQuestion()}, agents, ru.scope.Settings)
	rec.Confidence, rec.LatencyMs = res.Confidence, res.Latency.Milliseconds()
	switch res.Decision {
	case systemone.RouteRouted:
		rec.Decision = systemone.RouteRouted
		for i, a := range agents {
			if a.Key == res.Key {
				return ru.delegate(ctx, cards[i])
			}
		}
		rec.Decision = systemone.RouteNone
		return ru.refuseRouter(ctx, NoContextNoAgent)
	case systemone.RouteSmallTalk:
		rec.Decision = systemone.RouteSmallTalk
		return ru.smallTalk(ctx)
	case systemone.RouteNone:
		rec.Decision = systemone.RouteNone
		return ru.refuseRouter(ctx, NoContextNoAgent)
	}
	ru.s.Log.Warn("routing failed; answering as if no agent fit", "err", res.Err, "agent", ru.agent.ID)
	return ru.refuseRouter(ctx, NoContextRouteUnavailable)
}

// refuseRouter is a router's refusal: nothing fits, or it cannot choose.
func (ru *run) refuseRouter(ctx context.Context, reason string) (Answer, error) {
	ru.noContextReason = reason
	return ru.refuseWithoutModel(ctx)
}

// routerRefusal is the text of a router's refusal for a no-context reason ("" for the others).
func (ru *run) routerRefusal() string {
	switch ru.noContextReason {
	case NoContextRouteUnavailable:
		return routeUnavailableMessage
	case NoContextNoAgent:
		if ru.cfg.RefusalMessage == DefaultRefusal {
			return DefaultNoAgent
		}
		return ru.cfg.RefusalMessage
	}
	return ""
}

// routeCandidates are the agents the asker may chat with that routers may reach, by name, at most MaxRouteCandidates.
// Who may chat with what is the directory's decision (mayUse, the public switch): nothing here widens it.
func (ru *run) routeCandidates(ctx context.Context) []Card {
	cards, err := ru.s.Directory(ctx, ru.a, DirectoryFilter{})
	if err != nil {
		ru.s.Log.Warn("router: list agents", "err", err, "agent", ru.agent.ID)
		return nil
	}
	out := cards[:0]
	for _, c := range cards {
		if c.Routable && !c.Router && c.Agent.ID != ru.agent.ID && c.Agent.Status == StatusActive {
			out = append(out, c)
		}
	}
	out, reachable := sortAndCap(out, MaxRouteCandidates)
	if reachable > len(out) {
		ru.s.Log.Warn("router: more agents are reachable than are considered", "reachable", reachable, "considered", len(out), "agent", ru.agent.ID)
	}
	return out
}

// sortAndCap orders candidates by name (then ID, so the order is stable) and keeps the first limit; it also returns how
// many there were.
func sortAndCap(cards []Card, limit int) ([]Card, int) {
	slices.SortFunc(cards, func(a, b Card) int {
		if c := strings.Compare(strings.ToLower(a.Agent.Name), strings.ToLower(b.Agent.Name)); c != 0 {
			return c
		}
		return strings.Compare(a.Agent.ID.String(), b.Agent.ID.String())
	})
	n := len(cards)
	if n > limit {
		cards = cards[:limit]
	}
	return cards, n
}

// routerProblems are what stops a router from being published: it searches nothing and calls no tools (it would have two
// ways of answering), and it needs the SystemOne scope check to choose with.
func (s *Service) routerProblems(ctx context.Context, c Config) []Problem {
	var probs []Problem
	add := func(field, msg string) { probs = append(probs, Problem{Field: field, Problem: msg}) }
	if len(c.KBs) > 0 {
		add("kbs", "A router doesn't search: it sends each question to another agent. Remove the knowledge bases")
	}
	if len(c.Tools) > 0 {
		add("tools", "A router doesn't call tools: it sends each question to another agent. Remove the tools")
	}
	var o systemone.Override
	if c.SystemOne != nil {
		o = *c.SystemOne
	}
	if s.SystemOne == nil {
		add("router", "Routing needs the SystemOne scope check, which isn't set up on this platform")
	} else if plans, err := s.SystemOne.Plans(ctx, o); err != nil || plans.Scope == nil {
		add("router", "Routing needs the SystemOne scope check, which is switched off. A platform admin can switch it on under Admin → SystemOne, and this agent's own SystemOne setting must not turn it off")
	}
	return probs
}

// routedConversation is the asker's conversation with the target that this router conversation last sent a question to,
// so a follow-up to the same agent continues it (nil: a new conversation).
func (ru *run) routedConversation(ctx context.Context, target uuid.UUID) *uuid.UUID {
	if ru.conv == nil {
		return nil
	}
	var id *uuid.UUID
	err := ru.s.Pool.QueryRow(ctx, `SELECT (e.routing->>'conversationId')::uuid FROM message_events e JOIN messages m ON m.id = e.message_id
		WHERE m.conversation_id = $1 AND e.routing->>'agentId' = $2 AND e.routing->>'conversationId' IS NOT NULL
		ORDER BY m.seq DESC LIMIT 1`, ru.conv.ID, target.String()).Scan(&id)
	if err != nil {
		return nil
	}
	return id
}

// forwardedEvents are the target's events the router passes on as its own: progress, retrieval and the text. Its
// conversation, message start and end, checks and suggestions belong to the target's message, not the router's.
var forwardedEvents = map[string]bool{"status": true, "retrieval": true, "thinking_delta": true, "text_delta": true, "text_reset": true,
	"tool_call": true, "tool_result": true}

// delegate runs the target as an ordinary chat of the asker and shows its answer as the router's.
func (ru *run) delegate(ctx context.Context, c Card) (Answer, error) {
	st := &loopState{}
	forward := func(ev Event) {
		if !forwardedEvents[ev.Type] {
			return
		}
		switch ev.Type {
		case "status", "retrieval":
			ru.out.start()
		case "text_delta":
			ru.startAnswer(st)
			ru.markFirstToken()
		default:
			ru.startAnswer(st)
		}
		ru.out.send(ev)
	}
	prev := ru.routedConversation(ctx, c.Agent.ID)
	tans, err := ru.chatWithTarget(ctx, c, prev, forward)
	if err != nil && prev != nil && isNoConversation(err) { // the earlier conversation is gone: start another
		tans, err = ru.chatWithTarget(ctx, c, nil, forward)
	}
	if err != nil {
		return ru.failBeforeStart(ctx, err)
	}
	ru.routeRec.AgentID, ru.routeRec.ConversationID = &c.Agent.ID, tans.ConversationID
	ru.startAnswer(st)
	ru.markFirstToken()
	ans := ru.baseAnswer()
	ans.Text, ans.Citations, ans.Sources = tans.Text, tans.Citations, tans.Sources
	ans.StopReason, ans.ErrorCode, ans.ErrorMessage = tans.StopReason, tans.ErrorCode, tans.ErrorMessage
	ans.Refused, ans.Thinking = tans.Refused, tans.Thinking
	ans.routedTo = &RoutedView{AgentID: c.Agent.ID, Name: c.Agent.Name, Slug: c.Agent.Slug, TeamSlug: c.TeamSlug, TeamName: c.TeamName, ConversationID: tans.ConversationID}
	if ans.Citations == nil {
		ans.Citations = []Citation{}
	}
	msg := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: ans.Text}}, StopReason: llm.StopReason(ans.StopReason)}
	ru.record(ctx, &ans, &msg, nil)
	ru.sendEnd(ans)
	return ans, nil
}

func isNoConversation(err error) bool {
	var e *apperr.Error
	return errors.As(err, &e) && e.Code == conversationNotFoundCode
}

// chatWithTarget asks the target as the router's asker: a signed-in person in their own conversation with it, an
// anonymous visitor in their session's.
func (ru *run) chatWithTarget(ctx context.Context, c Card, conv *uuid.UUID, emit func(Event)) (Answer, error) {
	if ru.anon != nil {
		caller := *ru.anon
		caller.ConversationID = conv
		return ru.s.PublicChat(ctx, caller, c.Agent.ID, ru.question, conv == nil, emit)
	}
	return ru.s.Chat(ctx, ru.a, ChatRequest{TeamRef: c.TeamSlug, AgentRef: c.Agent.Slug, Message: ru.question, ConversationID: conv,
		Channel: ru.channel}, emit)
}

// hasRoutedAnswers: a router sent a question of this conversation, up to message seq, to another agent. Such a
// conversation can't be shared: the answer is the target's and its audience is the target's.
func (s *Service) hasRoutedAnswers(ctx context.Context, conversationID uuid.UUID, upTo int32) (bool, error) {
	var routed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM message_events e JOIN messages m ON m.id = e.message_id
		WHERE m.conversation_id = $1 AND m.seq <= $2 AND e.routing->>'decision' = 'routed')`, conversationID, upTo).Scan(&routed)
	return routed, err
}

// RoutedView says which agent answered a router's question, and where the conversation with it continues.
type RoutedView struct {
	AgentID        uuid.UUID  `json:"agentId"`
	Name           string     `json:"name"`
	Slug           string     `json:"slug"`
	TeamSlug       string     `json:"teamSlug"`
	TeamName       string     `json:"teamName"`
	ConversationID *uuid.UUID `json:"conversationId,omitempty"`
	// Gone: the agent has been removed since.
	Gone bool `json:"gone,omitempty"`
}

// attachRouting sets RoutedTo on the answers a router sent on, from their routing records. Names and slugs are the agents' now.
func (s *Service) attachRouting(ctx context.Context, rows []dbgen.ListMessagesRow, views []MessageView) {
	recs := map[uuid.UUID]RoutingRecord{}
	var ids []uuid.UUID
	for _, r := range rows {
		var rec RoutingRecord
		if len(r.Routing) == 0 || json.Unmarshal(r.Routing, &rec) != nil || rec.Decision != systemone.RouteRouted || rec.AgentID == nil {
			continue
		}
		recs[r.ID] = rec
		ids = append(ids, *rec.AgentID)
	}
	if len(recs) == 0 {
		return
	}
	type who struct {
		name, slug, team, teamName string
		gone                       bool
	}
	known := map[uuid.UUID]who{}
	q, err := s.Pool.Query(ctx, `SELECT a.id, a.name, a.slug, t.slug, t.name, a.deleted_at IS NOT NULL FROM agents a JOIN teams t ON t.id = a.team_id WHERE a.id = ANY($1)`, ids)
	if err != nil {
		s.Log.Warn("router: name the agents", "err", err)
		return
	}
	defer q.Close()
	for q.Next() {
		var id uuid.UUID
		var w who
		if q.Scan(&id, &w.name, &w.slug, &w.team, &w.teamName, &w.gone) == nil {
			known[id] = w
		}
	}
	for i := range views {
		rec, ok := recs[views[i].ID]
		if !ok {
			continue
		}
		w, found := known[*rec.AgentID]
		views[i].RoutedTo = &RoutedView{AgentID: *rec.AgentID, Name: w.name, Slug: w.slug, TeamSlug: w.team, TeamName: w.teamName,
			ConversationID: rec.ConversationID, Gone: w.gone || !found}
	}
}
