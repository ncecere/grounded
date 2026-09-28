package llm

import (
	"encoding/json"
	"fmt"
)

// Role identifies a message kind.
type Role string

const (
	RoleUser       Role = "user"
	RoleAssistant  Role = "assistant"
	RoleToolResult Role = "toolResult"
)

// Message is one of UserMessage, AssistantMessage or ToolResultMessage
// (values, not pointers).
type Message interface {
	MessageRole() Role
}

// UserMessage is a user turn.
type UserMessage struct {
	Content string
}

// AssistantMessage is a model response. Content blocks appear in the order the
// model produced them.
type AssistantMessage struct {
	Content    []Block
	Model      string // the upstream model that was asked
	ResponseID string // the provider's completion ID, when reported
	Usage      Usage
	StopReason StopReason
	// ErrorMessage explains StopReason error or aborted. ErrorKind is the
	// gateway error kind (gateway.Kind*) when the failure came from the proxy.
	ErrorMessage string
	ErrorKind    string
}

// ToolResultMessage answers one tool call. Content is sent to the model;
// Details is for the application (for example retrieval hits) and is never
// sent.
type ToolResultMessage struct {
	ToolCallID string
	ToolName   string
	Content    string
	Details    any
	IsError    bool
}

func (UserMessage) MessageRole() Role       { return RoleUser }
func (AssistantMessage) MessageRole() Role  { return RoleAssistant }
func (ToolResultMessage) MessageRole() Role { return RoleToolResult }

// StopReason says why an assistant message ended.
type StopReason string

const (
	StopReasonStop    StopReason = "stop"
	StopReasonLength  StopReason = "length"
	StopReasonToolUse StopReason = "toolUse"
	StopReasonError   StopReason = "error"
	StopReasonAborted StopReason = "aborted"
)

// Usage is token usage for one response. Reasoning is a subset of Output and
// CacheRead/CacheWrite are subsets of Input, so Input+Output is what the
// provider billed; Total is the provider's total when reported.
type Usage struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	Reasoning  int `json:"reasoning"`
	CacheRead  int `json:"cacheRead"`
	CacheWrite int `json:"cacheWrite"`
	Total      int `json:"total"`
}

// Block is one of Text, Thinking or ToolCall (values, not pointers).
type Block interface {
	BlockType() string
}

// Text is visible answer text.
type Text struct {
	Text string
}

// Thinking is model reasoning. It is shown to the user (collapsed) and stored,
// but never sent back to the model.
type Thinking struct {
	Text string
}

// ToolCall asks for a tool to run. Arguments is the JSON the model produced:
// an object when it parsed, a JSON string holding the raw text when it did not
// (so validation reports it to the model), or null while still streaming.
type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

func (Text) BlockType() string     { return "text" }
func (Thinking) BlockType() string { return "thinking" }
func (ToolCall) BlockType() string { return "toolCall" }

// Text returns the concatenated text blocks.
func (m AssistantMessage) Text() string {
	var s string
	for _, b := range m.Content {
		if t, ok := b.(Text); ok {
			s += t.Text
		}
	}
	return s
}

// Thinking returns the concatenated thinking blocks.
func (m AssistantMessage) Thinking() string {
	var s string
	for _, b := range m.Content {
		if t, ok := b.(Thinking); ok {
			s += t.Text
		}
	}
	return s
}

// ToolCalls returns the tool calls in order.
func (m AssistantMessage) ToolCalls() []ToolCall {
	var out []ToolCall
	for _, b := range m.Content {
		if tc, ok := b.(ToolCall); ok {
			out = append(out, tc)
		}
	}
	return out
}

// Clone returns a copy whose Content slice can be changed independently.
func (m AssistantMessage) Clone() AssistantMessage {
	m.Content = append([]Block(nil), m.Content...)
	return m
}

// --- JSON ---------------------------------------------------------------
//
// Messages and blocks marshal with a discriminator ("role" / "type") so
// transcripts can be stored and read back with UnmarshalMessage and
// UnmarshalBlocks.

func (b Text) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{"text", b.Text})
}

func (b Thinking) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{"thinking", b.Text})
}

func (b ToolCall) MarshalJSON() ([]byte, error) {
	args := b.Arguments
	if len(args) == 0 {
		args = json.RawMessage("null")
	}
	return json.Marshal(struct {
		Type      string          `json:"type"`
		ID        string          `json:"id"`
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}{"toolCall", b.ID, b.Name, args})
}

// UnmarshalBlocks decodes a JSON array of content blocks.
func UnmarshalBlocks(data []byte) ([]Block, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal(data, &raws); err != nil {
		return nil, err
	}
	out := make([]Block, 0, len(raws))
	for _, r := range raws {
		var b struct {
			Type      string          `json:"type"`
			Text      string          `json:"text"`
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(r, &b); err != nil {
			return nil, err
		}
		switch b.Type {
		case "text":
			out = append(out, Text{Text: b.Text})
		case "thinking":
			out = append(out, Thinking{Text: b.Text})
		case "toolCall":
			out = append(out, ToolCall{ID: b.ID, Name: b.Name, Arguments: b.Arguments})
		default:
			return nil, fmt.Errorf("llm: unknown block type %q", b.Type)
		}
	}
	return out, nil
}

type userJSON struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
}

type assistantJSON struct {
	Role         Role            `json:"role"`
	Content      json.RawMessage `json:"content"`
	Model        string          `json:"model,omitempty"`
	ResponseID   string          `json:"responseId,omitempty"`
	Usage        Usage           `json:"usage"`
	StopReason   StopReason      `json:"stopReason"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	ErrorKind    string          `json:"errorKind,omitempty"`
}

type toolResultJSON struct {
	Role       Role   `json:"role"`
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Content    string `json:"content"`
	Details    any    `json:"details,omitempty"`
	IsError    bool   `json:"isError"`
}

func (m UserMessage) MarshalJSON() ([]byte, error) {
	return json.Marshal(userJSON{RoleUser, m.Content})
}

func (m AssistantMessage) MarshalJSON() ([]byte, error) {
	content := m.Content
	if content == nil {
		content = []Block{}
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	return json.Marshal(assistantJSON{
		Role: RoleAssistant, Content: raw, Model: m.Model, ResponseID: m.ResponseID, Usage: m.Usage,
		StopReason: m.StopReason, ErrorMessage: m.ErrorMessage, ErrorKind: m.ErrorKind,
	})
}

func (m *AssistantMessage) UnmarshalJSON(data []byte) error {
	var a assistantJSON
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	var content []Block
	if len(a.Content) > 0 && string(a.Content) != "null" {
		var err error
		if content, err = UnmarshalBlocks(a.Content); err != nil {
			return err
		}
	}
	*m = AssistantMessage{
		Content: content, Model: a.Model, ResponseID: a.ResponseID, Usage: a.Usage,
		StopReason: a.StopReason, ErrorMessage: a.ErrorMessage, ErrorKind: a.ErrorKind,
	}
	return nil
}

func (m ToolResultMessage) MarshalJSON() ([]byte, error) {
	return json.Marshal(toolResultJSON{RoleToolResult, m.ToolCallID, m.ToolName, m.Content, m.Details, m.IsError})
}

func (m *ToolResultMessage) UnmarshalJSON(data []byte) error {
	var t toolResultJSON
	if err := json.Unmarshal(data, &t); err != nil {
		return err
	}
	*m = ToolResultMessage{ToolCallID: t.ToolCallID, ToolName: t.ToolName, Content: t.Content, Details: t.Details, IsError: t.IsError}
	return nil
}

// UnmarshalMessage decodes a message written by json.Marshal of any Message.
func UnmarshalMessage(data []byte) (Message, error) {
	var head struct {
		Role Role `json:"role"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return nil, err
	}
	switch head.Role {
	case RoleUser:
		var u userJSON
		if err := json.Unmarshal(data, &u); err != nil {
			return nil, err
		}
		return UserMessage{Content: u.Content}, nil
	case RoleAssistant:
		var a AssistantMessage
		if err := json.Unmarshal(data, &a); err != nil {
			return nil, err
		}
		return a, nil
	case RoleToolResult:
		var t ToolResultMessage
		if err := json.Unmarshal(data, &t); err != nil {
			return nil, err
		}
		return t, nil
	}
	return nil, fmt.Errorf("llm: unknown message role %q", head.Role)
}
