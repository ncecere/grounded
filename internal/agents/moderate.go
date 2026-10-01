// Moderation in the chat pipeline (docs/phase4-publishing.md §2 and §4,
// ADR-0019): the question is checked concurrently with the query rewrite
// and the search, before the search's results are judged or used (a
// blocked question's are discarded); the final answer is checked before it
// is stored.
// Streamed answers that fail are retracted; buffered answers are sent only
// after they pass. Only decisions are recorded, never the text (ADR-0010).

package agents

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
)

// Moderation actions reported in the moderation event.
const (
	ModerationBlocked     = "blocked"     // the question was blocked
	ModerationRetracted   = "retracted"   // the streamed answer was replaced
	ModerationWithheld    = "withheld"    // the buffered answer was never sent
	ModerationUnavailable = "unavailable" // the provider failed and the policy fails closed
	// ModerationSupport: a support action replaced the question's answer
	// or the answer with the support message (docs/systemone.md §1).
	ModerationSupport = "support"
)

// Error codes of stored messages replaced by a moderation notice. They are
// not answer errors: message_events keeps error_code empty and records the
// decision in moderation_input / moderation_output.
const (
	codeModerationBlocked  = "moderation_blocked"
	codeModerationWithheld = "moderation_withheld"
	codeModerationSupport  = "moderation_support"
	// codeModerationUnavailable: the provider failed and the policy fails
	// closed (the notice asks to try again).
	codeModerationUnavailable = "moderation_unavailable"
)

// planModeration resolves the audience's policy with the agent's override.
func (ru *run) planModeration(ctx context.Context) error {
	if ru.s.Moderation == nil || ru.mod != nil { // planned already (the answer cache's near-identical lookup)
		return nil
	}
	plan, err := ru.s.Moderation.Plan(ctx, ru.grant, ru.cfg.Moderation)
	ru.mod = plan
	return err
}

// startInputCheck checks the question in the background (nil when input
// is not moderated).
func (ru *run) startInputCheck(ctx context.Context) <-chan moderation.Decision {
	if !ru.mod.Active(moderation.StageInput) {
		return nil
	}
	ch := make(chan moderation.Decision, 1)
	if ru.modIn != nil { // checked already (cache.go)
		ch <- *ru.modIn
		return ch
	}
	go func() {
		ch <- ru.mod.Check(ctx, moderation.Input{Stage: moderation.StageInput, Text: ru.question})
	}()
	return ch
}

// awaitInput waits for the input check and reports whether it blocks.
func (ru *run) awaitInput(ch <-chan moderation.Decision) bool {
	if ch == nil {
		return false
	}
	d := <-ch
	ru.modIn = &d
	return d.Blocked
}

// moderationEvent describes a blocking decision for the client.
func (ru *run) moderationEvent(d moderation.Decision, blockedAction string) ModerationEvent {
	switch d.Outcome {
	case moderation.DecisionError:
		return ModerationEvent{Stage: d.Stage, Action: ModerationUnavailable, Notice: moderation.UnavailableNotice}
	case moderation.DecisionSupport:
		return ModerationEvent{Stage: d.Stage, Action: ModerationSupport, Category: d.TopCategory, Notice: ru.mod.Policy.SupportMessage}
	}
	return ModerationEvent{Stage: d.Stage, Action: blockedAction, Category: d.TopCategory, Notice: ru.mod.Policy.Notice}
}

// blockInput answers a blocked question with the notice: nothing is
// retrieved and no model is called.
func (ru *run) blockInput(ctx context.Context) (Answer, error) {
	ev := ru.moderationEvent(*ru.modIn, ModerationBlocked)
	st := &loopState{}
	ru.startAnswer(st)
	ru.out.send(Event{"moderation", ev})
	ans := ru.baseAnswer()
	ans.Text, ans.StopReason, ans.Moderation, ans.storedCode = ev.Notice, string(llm.StopReasonStop), &ev, storedModerationCode(ev, codeModerationBlocked)
	msg := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: ev.Notice}}, StopReason: llm.StopReasonStop}
	ru.record(ctx, &ans, &msg, nil)
	ru.sendEnd(ans)
	return ans, nil
}

// sendDelta streams model text, except in buffer mode, where the text is
// sent by releaseBuffered once the answer passes, and in checked-paragraph
// mode, where it is sent paragraph by paragraph once each passes
// (streamcheck.go); thinking is not sent in either.
func (ru *run) sendDelta(kind, delta string) {
	switch {
	case ru.mod.Buffered():
		return
	case ru.mod.Checked():
		if ru.checked != nil && kind == "text_delta" {
			ru.checked.write(delta)
		}
		return
	}
	ru.out.send(Event{kind, DeltaEvent{Delta: delta}})
}

// moderateOutput checks the final answer. When it is blocked, the answer
// becomes the notice (thinking, citations and tool calls are dropped) and
// withheld is true. The check runs even if the client left, so the stored
// answer is moderated too; the moderation timeout bounds it.
func (ru *run) moderateOutput(ctx context.Context, ans *Answer) (withheld bool) {
	if ru.checked != nil { // checked paragraph by paragraph as it streamed
		return ru.settleChecked(ans)
	}
	if !ru.mod.Active(moderation.StageOutput) || ans.Refused || strings.TrimSpace(ans.Text) == "" {
		return false
	}
	d := ru.mod.Check(context.WithoutCancel(ctx), moderation.Input{Stage: moderation.StageOutput, Text: ans.Text, Question: ru.question})
	ru.modOut = &d
	if !d.Blocked {
		return false
	}
	action := ModerationRetracted
	if ru.mod.Buffered() || ru.mod.Checked() { // a checked answer is checked whole only when nothing streams
		action = ModerationWithheld
	}
	ev := ru.moderationEvent(d, action)
	ru.out.send(Event{"moderation", ev})
	ans.Text, ans.Thinking, ans.Citations, ans.Moderation, ans.storedCode = ev.Notice, "", []Citation{}, &ev, storedModerationCode(ev, codeModerationWithheld)
	return true
}

// storedModerationCode is the stored message's code for a moderation
// event: support replacements and an unavailable provider have their own.
func storedModerationCode(ev ModerationEvent, code string) string {
	switch ev.Action {
	case ModerationSupport:
		return codeModerationSupport
	case ModerationUnavailable:
		return codeModerationUnavailable
	}
	return code
}

// releaseBuffered sends a buffered answer's text after it passed: the
// model's text, or the answer's when a citation check changed it.
func (ru *run) releaseBuffered(st *loopState, withheld bool, ans Answer) {
	if !ru.mod.Buffered() || withheld || st.textSoFar.Len() == 0 {
		return
	}
	text := st.textSoFar.String()
	if ru.citeChanged {
		text = ans.Text
	}
	ru.out.send(Event{"text_delta", DeltaEvent{Delta: text}})
}

// moderationRecords are the message_events columns (NULL when a stage was
// not moderated).
func (ru *run) moderationRecords() (in, out json.RawMessage) {
	enc := func(d *moderation.Decision, checks int) json.RawMessage {
		if d == nil {
			return nil
		}
		rec := d.Record()
		rec.Checks = checks
		b, _ := json.Marshal(rec)
		return b
	}
	return enc(ru.modIn, 0), enc(ru.modOut, ru.modChecks)
}

// moderationProblem is the publish problem of an override that cannot take
// effect: the audience's policy has no provider ("" when fine). It is also
// a draft warning (field draft.moderation) the editor shows beside the
// rules, with a link to the moderation admin page (docs/ui-review F-18).
func (s *Service) moderationProblem(ctx context.Context, c Config, audience string) (string, error) {
	if c.Moderation.IsZero() || s.Moderation == nil {
		return "", nil
	}
	ok, err := s.Moderation.HasProvider(ctx, audience)
	if err != nil || ok {
		return "", err
	}
	name := map[string]string{"team": "team", "all_authenticated": "signed-in users", "public": "public"}[audience]
	return "No moderation provider is set for the " + name + " audience, so these stricter rules have no effect " +
		"and the agent can't be published with them. A platform admin can set one under Admin → Moderation.", nil
}

// isModerationCode reports a stored message replaced by a notice.
func isModerationCode(code string) bool {
	return code == codeModerationBlocked || code == codeModerationWithheld || code == codeModerationSupport ||
		code == codeModerationUnavailable
}
