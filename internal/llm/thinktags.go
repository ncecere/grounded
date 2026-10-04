// Reasoning in the answer text (v0.4.2 BU-02): some models put their
// reasoning in content between <think> and </think> instead of a reasoning
// field, and Qwen3 with thinking turned off (chat_template_kwargs
// enable_thinking false) sometimes reasons anyway after a tool result and
// ends it with a bare </think>: "Draft answer.\n</think>\n\nAnswer." Shown as
// text, a visitor saw the tag and the answer twice. The assembler routes
// tagged reasoning to thinking blocks; a bare </think> turns the message's
// text so far into thinking (EventTextToThinking).

package llm

import (
	"strings"
	"unicode"
)

const (
	thinkOpen  = "<think>"
	thinkClose = "</think>"
)

// content routes a content delta: text, or reasoning between think tags. A
// suffix that may be the start of a tag is held until the next delta.
func (a *assembler) content(delta string) {
	s := a.tagHold + delta
	a.tagHold = ""
	for s != "" {
		if a.inThink {
			i := strings.Index(s, thinkClose)
			if i < 0 {
				keep := partialTag(s, thinkClose)
				a.thinkText(s[:len(s)-keep])
				a.tagHold = s[len(s)-keep:]
				return
			}
			a.thinkText(s[:i])
			a.inThink, a.afterThink = false, true
			s = s[i+len(thinkClose):]
			continue
		}
		open, closing := strings.Index(s, thinkOpen), strings.Index(s, thinkClose)
		switch {
		case open >= 0 && (closing < 0 || open < closing):
			a.answerText(s[:open])
			a.inThink = true
			s = s[open+len(thinkOpen):]
		case closing >= 0:
			a.reasoningEnded(s[:closing])
			s = s[closing+len(thinkClose):]
		default:
			keep := max(partialTag(s, thinkOpen), partialTag(s, thinkClose))
			a.answerText(s[:len(s)-keep])
			a.tagHold = s[len(s)-keep:]
			return
		}
	}
}

// answerText adds text after the reasoning: the whitespace the tag left
// before the answer is dropped.
func (a *assembler) answerText(s string) {
	if a.afterThink {
		if s = strings.TrimLeftFunc(s, unicode.IsSpace); s == "" {
			return
		}
		a.afterThink = false
	}
	if s != "" {
		a.appendContent(s)
	}
}

func (a *assembler) thinkText(s string) {
	if strings.TrimSpace(s) != "" || (a.open >= 0 && a.isThinking(a.open)) {
		a.appendText(true, s)
	}
}

func (a *assembler) isThinking(i int) bool {
	_, ok := a.msg.Content[i].(Thinking)
	return ok
}

// reasoningEnded handles a bare </think>: the message's text so far and
// before (the text in front of the tag) were the model's reasoning.
func (a *assembler) reasoningEnded(before string) {
	a.closeOpen()
	moved := false
	for i, b := range a.msg.Content {
		if t, ok := b.(Text); ok {
			a.msg.Content[i] = Thinking(t)
			moved = true
		}
	}
	a.pendingSpace = ""
	if moved {
		a.emit(Event{Type: EventTextToThinking, ContentIndex: -1})
	}
	a.thinkText(before)
	a.closeOpen()
	a.afterThink = true
}

// flushTags ends the content at the end of the response: a held partial
// tag was text (or reasoning, inside <think>).
func (a *assembler) flushTags() {
	s := a.tagHold
	a.tagHold = ""
	if s == "" {
		return
	}
	if a.inThink {
		a.thinkText(s)
		return
	}
	a.answerText(s)
}

// partialTag is the length of the longest suffix of s that is a proper
// prefix of tag.
func partialTag(s, tag string) int {
	for n := min(len(s), len(tag)-1); n > 0; n-- {
		if strings.HasSuffix(s, tag[:n]) {
			return n
		}
	}
	return 0
}
