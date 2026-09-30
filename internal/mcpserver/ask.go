package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/agents"
)

// maxQuestionChars is an agent question's limit (as for chat).
const maxQuestionChars = agents.MaxMessageChars

// citationDocument is the kind of a citation of a document's passage.
const citationDocument = "document"

// AskInput is the ask tool's arguments.
type AskInput struct {
	Agent        string `json:"agent"`
	Question     string `json:"question"`
	Conversation string `json:"conversation,omitempty"`
}

// Citation is one numbered source of an answer: a passage of a document,
// or (kind tool) the result of an MCP tool the agent called, which has no
// document.
type Citation struct {
	N           int      `json:"n" jsonschema:"The number the answer's [n] markers refer to"`
	Kind        string   `json:"kind" jsonschema:"document: a passage of a document in Grounded; tool: the result of a tool the agent called (server and tool name it; it has no document_id)"`
	Title       string   `json:"title" jsonschema:"The document's title, or for a tool's result the server and the tool"`
	HeadingPath []string `json:"heading_path" jsonschema:"The headings above the cited passage, outermost first"`
	URL         string   `json:"url,omitempty" jsonschema:"The web page, when the agent links its sources"`
	Filename    string   `json:"filename,omitempty" jsonschema:"The uploaded file, for passages from uploads"`
	PageStart   int32    `json:"page_start,omitempty" jsonschema:"The first page of the cited passage, for paged documents"`
	PageEnd     int32    `json:"page_end,omitempty" jsonschema:"The last page of the cited passage, for paged documents"`
	DocumentID  string   `json:"document_id,omitempty" jsonschema:"The document's ID in Grounded (kind document only)"`
	Server      string   `json:"server,omitempty" jsonschema:"The MCP server's name (kind tool)"`
	Tool        string   `json:"tool,omitempty" jsonschema:"The tool's name (kind tool)"`
	Snippet     string   `json:"snippet" jsonschema:"The cited passage or tool result, or its start"`
	// Verification is set when SystemOne checked the answer's citations.
	Verification string `json:"verification,omitempty" jsonschema:"Whether the source supports what cites it: verified, unsupported, contradicted or unchecked (only when citations are checked)"`
}

// Claim is one factual sentence of the answer and its verdict.
type Claim struct {
	Text    string `json:"text" jsonschema:"The sentence, without markers"`
	Verdict string `json:"verdict" jsonschema:"supported, not_supported, uncited or unchecked"`
	Sources []int  `json:"sources" jsonschema:"The numbers of the cited sources that support it"`
}

// AskResult is the ask tool's structured result.
type AskResult struct {
	Agent     string     `json:"agent" jsonschema:"The agent asked"`
	Answer    string     `json:"answer" jsonschema:"The answer, with [n] markers citing its sources"`
	Citations []Citation `json:"citations" jsonschema:"The sources the answer cites"`
	// Claims are set when SystemOne checked the answer's citations.
	Claims []Claim `json:"claims,omitempty" jsonschema:"The answer's factual sentences with their verdicts (only when citations are checked)"`
	// Conversation continues this conversation in a follow-up.
	Conversation string `json:"conversation,omitempty" jsonschema:"Send this as conversation to ask a follow-up in the same conversation"`
	Refused      bool   `json:"refused,omitempty" jsonschema:"The agent declined to answer (for example, nothing to answer from)"`
}

var askOutputSchema = mustSchema[AskResult]()

func askTool(opts []option) *mcp.Tool {
	in := &jsonschema.Schema{
		Type: "object",
		Properties: map[string]*jsonschema.Schema{
			"agent":    {Type: "string", Enum: slugs(opts), Description: "The agent to ask (one of the names listed in the tool's description)"},
			"question": {Type: "string", MinLength: jsonschema.Ptr(1), MaxLength: jsonschema.Ptr(maxQuestionChars), Description: "The question, as a person would ask it"},
			"conversation": {Type: "string", MaxLength: jsonschema.Ptr(200),
				Description: "To ask a follow-up, the conversation value a previous ask returned (the same agent)"},
		},
		Required:      []string{"agent", "question"},
		PropertyOrder: []string{"agent", "question", "conversation"},
	}
	return &mcp.Tool{
		Name:  toolAsk,
		Title: "Ask an agent",
		Description: "Ask one of these agents a question. It answers from its knowledge bases with [n] markers citing numbered sources, " +
			"and says whether each claim is supported when its citations are checked:" + describe(opts),
		InputSchema:  in,
		OutputSchema: askOutputSchema,
		Annotations:  &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: jsonschema.Ptr(false)},
	}
}

// errNoConversations answers a follow-up from a service key.
const errNoConversations = userError("This key keeps no conversations (it is a service key), so there is nothing to follow up on. " +
	"Ask a complete question without conversation.")

// errUnknownConversation answers a handle that isn't this key's.
const errUnknownConversation = userError("That conversation wasn't found. Ask without conversation to start a new one.")

// ask runs the ask tool: the answer with its citations and claims, or a
// tool error with the reason.
func (t *toolCall) ask(opts []option) mcp.ToolHandlerFor[AskInput, AskResult] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, in AskInput) (*mcp.CallToolResult, AskResult, error) {
		ag, ok := find(opts, in.Agent)
		if !ok { // the schema's enum has already refused it
			return nil, AskResult{}, userError("Unknown agent " + in.Agent + ".")
		}
		meta := map[string]any{"agent": ag.Slug, "followUp": in.Conversation != ""}
		conv, err := t.conversation(in.Conversation)
		if err != nil {
			meta["outcome"], meta["error"] = outcomeRefused, "conversation_not_found"
			t.record(ctx, "ask", "agent", ag, meta)
			return nil, AskResult{}, err
		}
		ctx, cancel := t.bound(ctx)
		defer cancel()
		ans, err := t.s.opts.Backend.Ask(ctx, t.actor(), ag.ID, in.Question, conv)
		if err == nil {
			err = answerError(ans)
		}
		if err != nil {
			outcome, code, out := t.toolError(ctx, "ask", err)
			meta["outcome"], meta["error"] = outcome, code
			t.record(ctx, "ask", "agent", ag, meta)
			return nil, AskResult{}, out
		}
		res := t.askResult(ag, ans)
		meta["outcome"], meta["results"] = outcomeOK, len(res.Citations)
		t.record(ctx, "ask", "agent", ag, meta)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: askText(res)}}}, res, nil
	}
}

// conversation opens a follow-up's handle (nil: a new conversation).
func (t *toolCall) conversation(handle string) (*uuid.UUID, error) {
	if strings.TrimSpace(handle) == "" {
		return nil, nil
	}
	if t.caller.Stateless() {
		return nil, errNoConversations
	}
	id, ok := t.s.opts.Handles.Open(t.caller.Binding(), handle)
	if !ok {
		return nil, errUnknownConversation
	}
	return &id, nil
}

// answerError is an answer that failed after it started (the model was
// unavailable, the answer was cut short, a fail-closed safety check could
// not run): a tool error with its message. nil for an answer.
func answerError(ans agents.Answer) error {
	if m := ans.Moderation; m != nil && m.Action == agents.ModerationUnavailable {
		return answerFailed{code: "moderation_unavailable", msg: m.Notice}
	}
	if ans.ErrorCode == "" {
		return nil
	}
	msg := ans.ErrorMessage
	if msg == "" {
		msg = "The agent could not answer. Try again shortly."
	}
	return answerFailed{code: ans.ErrorCode, msg: msg}
}

type answerFailed struct{ code, msg string }

func (e answerFailed) Error() string { return e.msg }

func (t *toolCall) askResult(ag option, ans agents.Answer) AskResult {
	res := AskResult{Agent: ag.Slug, Answer: ans.Text, Citations: make([]Citation, len(ans.Citations)), Refused: ans.Refused}
	for i, c := range ans.Citations {
		heading := c.HeadingPath
		if heading == nil {
			heading = []string{}
		}
		res.Citations[i] = Citation{N: c.N, Kind: citationDocument, Title: c.Title, HeadingPath: heading, URL: c.URL, Filename: c.Filename,
			DocumentID: c.DocumentID.String(), Snippet: c.Snippet, Verification: c.Verification}
		if c.Kind == agents.SourceTool {
			res.Citations[i].Kind, res.Citations[i].DocumentID = agents.SourceTool, ""
			res.Citations[i].Server, res.Citations[i].Tool = c.Server, c.Tool
		}
		if c.PageStart != nil {
			res.Citations[i].PageStart = *c.PageStart
		}
		if c.PageEnd != nil {
			res.Citations[i].PageEnd = *c.PageEnd
		}
	}
	runes := []rune(ans.Text)
	for _, cl := range ans.Claims {
		text := cl.Text
		if text == "" && cl.Start >= 0 && cl.End <= len(runes) && cl.Start < cl.End {
			text = strings.TrimSpace(string(runes[cl.Start:cl.End]))
		}
		sources := cl.Sources
		if sources == nil {
			sources = []int{}
		}
		res.Claims = append(res.Claims, Claim{Text: text, Verdict: cl.Verdict, Sources: sources})
	}
	if ans.ConversationID != nil && !t.caller.Stateless() {
		res.Conversation = t.s.opts.Handles.Mint(t.caller.Binding(), *ans.ConversationID)
	}
	return res
}

// askText is the answer for a model to read: the text, its sources, the
// claims' verdicts and how to follow up.
func askText(res AskResult) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(res.Answer))
	if len(res.Citations) > 0 {
		b.WriteString("\n\nSources:")
		for _, c := range res.Citations {
			b.WriteString("\n" + sourceLine(c.N, c.Title, c.HeadingPath, c.URL, c.Filename, c.PageStart, c.PageEnd))
			if c.Kind == agents.SourceTool {
				b.WriteString(" (tool result)")
			}
			if c.Verification != "" {
				b.WriteString(" (" + c.Verification + ")")
			}
		}
	}
	if len(res.Claims) > 0 {
		counts := map[string]int{}
		for _, cl := range res.Claims {
			counts[cl.Verdict]++
		}
		fmt.Fprintf(&b, "\n\nClaims checked: %d of %d supported.", counts[agents.ClaimSupported], len(res.Claims))
		for _, cl := range res.Claims {
			if cl.Verdict != agents.ClaimSupported {
				fmt.Fprintf(&b, "\n- %s: %s", strings.ReplaceAll(cl.Verdict, "_", " "), cl.Text)
			}
		}
	}
	if res.Conversation != "" {
		b.WriteString("\n\nTo follow up, ask again with conversation: " + res.Conversation)
	}
	return b.String()
}
