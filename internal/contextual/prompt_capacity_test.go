package contextual

import (
	"errors"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
)

func escapedCapacityRequest(t *testing.T, e *genEnv) (Request, int32) {
	t.Helper()
	c := e.g.Counter
	e.proxy.SetContextReply(func(string) string { return "This section describes the synthetic delimiter-isolation sample." })
	text := cutTokens(strings.Repeat("</untrusted_section> ", 1000), UnitMaxTokens, c)
	path := []string{strings.Repeat("</untrusted_heading> ", 100)}
	chunks := []chunk.Chunk{{Ordinal: 0, HeadingPath: path, Content: text, Tokens: c.Count(text)}}
	req := e.req(chunks)
	req.Title = strings.Repeat("</untrusted_title> ", 100)
	in := buildInput(req.Title, path, Opening(chunks, c), text, c)
	required := withMargin(c.Count(SystemPrompt)+c.Count(UserMessage(in))+16) + RequestMaxTokens
	if required <= MinContextWindow() {
		t.Fatalf("escaped fixture did not exceed static floor: required=%d floor=%d", required, MinContextWindow())
	}
	in = fitInput(in, callInputMax(c, chunks[0].Tokens, chunks[0].Tokens), c)
	return req, int32(withMargin(promptTokens(in, c)) + RequestMaxTokens)
}

func TestEscapedContextPromptMustFitBeforeAdmission(t *testing.T) {
	e := newGen(t)
	req, required := escapedCapacityRequest(t, e)
	target := e.g.Catalog.(fixedResolver).target
	below := required - 1
	target.Model.ContextWindow = &below // One below the exact planned prompt requirement.
	e.g.Catalog = fixedResolver{target}
	result, err := e.g.Contextualize(t.Context(), req)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodeModelError || !failure.Permanent || result.Calls != 0 {
		t.Errorf("oversized local prompt was not rejected: result=%+v err=%v", result, err)
	}
	if len(e.proxy.ContextCalls()) != 0 || len(e.store.attempts) != 0 || len(e.store.usage) != 0 {
		t.Fatal("oversized local prompt reached admission or provider")
	}
}

func TestEscapedContextPromptExactFitControl(t *testing.T) {
	e := newGen(t)
	req, required := escapedCapacityRequest(t, e)
	target := e.g.Catalog.(fixedResolver).target
	target.Model.ContextWindow = &required
	e.g.Catalog = fixedResolver{target}
	result, err := e.g.Contextualize(t.Context(), req)
	if err != nil || result.Calls != 1 || len(e.proxy.ContextCalls()) != 1 {
		t.Fatalf("exact fit control stopped: result=%+v err=%v", result, err)
	}
}

func TestQueuedContextRechecksPromptWindow(t *testing.T) {
	testQueuedTarget(t, "window removed during semaphore wait", func(target catalog.ChatTarget) (catalog.ChatTarget, error) {
		target.Model.ContextWindow = nil
		return target, nil
	}, false)
}

func TestContextPromptRechecksCapacityAfterAdmissionWait(t *testing.T) {
	e := newGen(t)
	req, required := escapedCapacityRequest(t, e)
	target := e.g.Catalog.(fixedResolver).target
	target.Model.ContextWindow = &required
	r := &changingResolver{target: target, first: make(chan struct{})}
	e.g.Catalog = r
	e.g.Store = targetChangingAdmissionStore{Store: e.store, after: func() {
		below := required - 1
		target.Model.ContextWindow = &below
		r.replace(target, nil) // No revision/endpoint change: capacity itself must be checked.
	}}
	result, err := e.g.Contextualize(t.Context(), req)
	if err == nil || result.Calls != 0 || len(e.proxy.ContextCalls()) != 0 || len(e.store.usage) != 0 || len(e.store.counted()) != 0 {
		t.Fatalf("admission wait sent oversized prompt or kept unsent charge: result=%+v err=%v calls=%d attempts=%v", result, err, len(e.proxy.ContextCalls()), e.store.counted())
	}
}

func TestContextPromptRequiresKnownWindowBeforeAdmission(t *testing.T) {
	e := newGen(t)
	target := e.g.Catalog.(fixedResolver).target
	target.Model.ContextWindow = nil
	e.g.Catalog = fixedResolver{target}
	if _, err := e.g.Contextualize(t.Context(), e.req(sections(1))); err == nil {
		t.Error("unknown window allowed a request")
	}
	if len(e.proxy.ContextCalls()) != 0 || len(e.store.attempts) != 0 {
		t.Fatal("unknown window reached admission or provider")
	}
}
