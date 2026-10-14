package catalog

import "testing"

// What a model Test's thinking-off result does to the model's stored check (#52).
func TestStoredThinkingOff(t *testing.T) {
	for _, c := range []struct {
		name   string
		in     *ThinkingOffTest
		action thinkingOffAction
		result string
	}{
		{"nothing configured: nothing to say, so nothing is kept", nil, clearThinkingOff, ""},
		{"honoured", &ThinkingOffTest{Honoured: true}, setThinkingOff, "honoured"},
		{"ignored", &ThinkingOffTest{Honoured: false, ReasoningTokens: 120}, setThinkingOff, "ignored"},
		{"ignored, tokens not reported", &ThinkingOffTest{Honoured: false}, setThinkingOff, "ignored"},
		// the check itself failed (a timeout, a gateway error): it says nothing about the model, so what was found
		// before stays, with its date
		{"could not run", &ThinkingOffTest{Error: "timeout"}, keepThinkingOff, ""},
		// an error wins over a Honoured left at its zero value
		{"could not run, honoured unset", &ThinkingOffTest{Honoured: false, Error: "gateway error"}, keepThinkingOff, ""},
	} {
		action, result := storedThinkingOff(c.in)
		if action != c.action || result != c.result {
			t.Errorf("%s: got (%v, %q), want (%v, %q)", c.name, action, result, c.action, c.result)
		}
	}
}
