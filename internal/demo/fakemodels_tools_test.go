package demo

import (
	"encoding/json"
	"strings"
	"testing"
)

// A request offering an MCP tool gets one call to it with the question in its
// required string arguments; once a tool result follows, the answer quotes it.
func TestFakeModelsCallsAnOfferedTool(t *testing.T) {
	req := func(body string) *fakeChatRequest {
		var in fakeChatRequest
		if err := json.Unmarshal([]byte(body), &in); err != nil {
			t.Fatal(err)
		}
		return &in
	}
	tools := `"tools":[{"type":"function","function":{"name":"search_knowledge","parameters":{}}},
		{"type":"function","function":{"name":"check_outage","parameters":{"type":"object","required":["service"],"properties":{"service":{"type":"string"}}}}}]`
	name, args, ok := demoToolCall(req(`{"messages":[{"role":"user","content":"Is email down?"}],` + tools + `}`))
	if !ok || name != "check_outage" || args != `{"service":"Is email down?"}` {
		t.Fatalf("call = %q %q %v", name, args, ok)
	}
	after := req(`{"messages":[{"role":"user","content":"Is email down?"},{"role":"assistant","content":""},
		{"role":"tool","content":"<sources>\n<source id=\"1\" title=\"Status · check_outage\">\nEmail is up.\n</source>\n</sources>"}],` + tools + `}`)
	if _, _, ok := demoToolCall(after); ok {
		t.Fatal("called again after the result")
	}
	if text, _ := fakeReply(after); !strings.Contains(text, "Email is up. [1]") {
		t.Fatalf("reply = %q", text)
	}
	if _, _, ok := demoToolCall(req(`{"messages":[{"role":"user","content":"hi"}]}`)); ok {
		t.Fatal("a call without tools")
	}
}
