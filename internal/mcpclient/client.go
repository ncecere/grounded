// Package mcpclient is the MCP client in agents (docs/v0.3.0.md §4,
// docs/mcp-client.md): the registry of remote MCP servers platform admins
// add (Admin → Models → MCP servers), their tool lists and the approval of
// each tool, stored health, and the tool calls agents make while answering.
//
// Grounded speaks Streamable HTTP only (no stdio: it never starts
// processes) through the official Go SDK, stateless protocol 2026-07-28
// first (server/discover) and the initialize handshake for older servers.
// It advertises no client capabilities: no roots, no sampling, no
// elicitation, and multi-round-trip input requests (MRTR) are refused, since
// an agent answering a person can't answer a remote server's questions.
package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/buildinfo"
	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tracing"
)

// Bounds of the client (docs/mcp-client.md, "Limits").
const (
	// DefaultMaxResponseBytes caps one HTTP response from a server.
	DefaultMaxResponseBytes = 1 << 20
	// MaxResultChars is how much of a tool's result the model reads; a
	// longer result is cut with a note.
	MaxResultChars = 8000
	// maxTools bounds a server's tool list.
	maxTools = 100
	// maxToolDescription and maxToolTitle bound what is stored per tool.
	maxToolDescription = 10000
	maxToolTitle       = 200
	maxToolName        = 128
)

// Service registers MCP servers, approves their tools and calls them.
type Service struct {
	pool *pgxpool.Pool
	q    *dbgen.Queries
	box  *secrets.Box
	// Health stores the results of Test (nil: not stored).
	Health *healthcheck.Service
	// AllowPrivate is the development allowance (DEV_AUTH on a loopback
	// APP_URL): private, loopback and link-local addresses, and http for
	// loopback hosts.
	AllowPrivate bool
	// MaxResponseBytes caps one HTTP response (DefaultMaxResponseBytes when 0).
	MaxResponseBytes int64
	Log              *slog.Logger
	lookup           resolver
}

// New returns a Service.
func New(pool *pgxpool.Pool, box *secrets.Box) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), box: box, Log: slog.Default(), lookup: defaultResolver}
}

// SetResolver replaces the DNS lookup (tests).
func (s *Service) SetResolver(f func(ctx context.Context, host string) ([]netip.Addr, error)) {
	s.lookup = f
}

func (s *Service) maxResponse() int64 {
	if s.MaxResponseBytes > 0 {
		return s.MaxResponseBytes
	}
	return DefaultMaxResponseBytes
}

// target is where and how to reach a server.
type target struct {
	name, url               string
	headerName, headerValue string
	timeout                 time.Duration
}

// ServerAAD binds a server's stored header value to its row (also used by
// key rotation, internal/keyrotation).
func ServerAAD(id uuid.UUID) []byte { return []byte("mcp_server:" + id.String()) }

// session is one connection to a server.
type session struct {
	cs   *mcp.ClientSession
	ex   *exchange
	done func()
}

func (s *session) close() {
	_ = s.cs.Close()
	s.done()
}

// open connects to a server: server/discover (2026-07-28), or the
// initialize handshake for older servers.
func (s *Service) open(ctx context.Context, t target) (*session, error) {
	ex := &exchange{}
	hc, done := s.httpClient(t, ex)
	client := mcp.NewClient(&mcp.Implementation{Name: "grounded", Title: "Grounded", Version: buildinfo.Version}, &mcp.ClientOptions{
		Logger: slog.New(slog.DiscardHandler),
		// No roots, sampling or elicitation: an agent answering a person
		// can't answer a remote server's questions.
		Capabilities:   &mcp.ClientCapabilities{},
		MultiRoundTrip: &mcp.MultiRoundTripOptions{Disabled: true},
	})
	// Trace context in each request's _meta (and, by the transport, in its
	// HTTP headers): docs/operations/tracing.md.
	client.AddSendingMiddleware(tracing.MCPClientMiddleware())
	tr := &mcp.StreamableClientTransport{Endpoint: t.url, HTTPClient: hc, MaxRetries: -1, DisableStandaloneSSE: true,
		MaxEventSize: int(s.maxResponse())}
	cs, err := client.Connect(ctx, tr, nil)
	if err != nil {
		done()
		return nil, s.classify(ctx, ex, err)
	}
	return &session{cs: cs, ex: ex, done: done}, nil
}

// ListedTool is a tool as the server lists it.
type ListedTool struct {
	Name, Title, Description string
	InputSchema              json.RawMessage
}

// listTools reads the server's tool list (all pages, at most maxTools).
func (s *Service) listTools(ctx context.Context, t target) ([]ListedTool, error) {
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	sess, err := s.open(ctx, t)
	if err != nil {
		return nil, err
	}
	defer sess.close()
	var out []ListedTool
	for tool, err := range sess.cs.Tools(ctx, nil) {
		if err != nil {
			return nil, s.classify(ctx, sess.ex, err)
		}
		if len(out) >= maxTools {
			return nil, &Error{Class: ClassBadResponse, Message: fmt.Sprintf("The server lists more than %d tools.", maxTools)}
		}
		out = append(out, listed(tool))
	}
	return out, nil
}

func listed(t *mcp.Tool) ListedTool {
	schema, err := json.Marshal(t.InputSchema)
	if err != nil || len(schema) == 0 || string(schema) == "null" {
		schema = json.RawMessage(`{"type":"object"}`)
	}
	title := t.Title
	if title == "" && t.Annotations != nil {
		title = t.Annotations.Title
	}
	return ListedTool{Name: t.Name, Title: clip(title, maxToolTitle), Description: clip(t.Description, maxToolDescription), InputSchema: schema}
}

func clip(s string, n int) string {
	s = strings.ToValidUTF8(s, "")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// CallResult is a tool's answer.
type CallResult struct {
	// Text is the result as the model reads it (at most MaxResultChars,
	// with a note when cut).
	Text string
	// IsError: the tool reported an error (Text is its message).
	IsError bool
	// Size is the result's length in bytes before it was cut.
	Size      int
	Truncated bool
}

// call runs tools/call and reads the result.
func (s *Service) call(ctx context.Context, t target, tool string, args json.RawMessage) (CallResult, error) {
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	sess, err := s.open(ctx, t)
	if err != nil {
		return CallResult{}, err
	}
	defer sess.close()
	var arguments map[string]any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &arguments); err != nil {
			return CallResult{}, &Error{Class: ClassBadRequest, Message: "The arguments are not a JSON object."}
		}
	}
	res, err := sess.cs.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: arguments})
	if err != nil {
		return CallResult{}, s.classify(ctx, sess.ex, err)
	}
	if res.NeedsInput() || len(res.InputRequests) > 0 {
		return CallResult{}, &Error{Class: ClassInputRequired,
			Message: "The tool asked for more input (an MCP input request); Grounded doesn't answer a server's questions."}
	}
	return resultOf(res), nil
}

// resultOf flattens a result's content to text: text parts and text
// resources as they are, structured content as JSON when there is no text,
// other parts (images, audio, binary resources) as a short placeholder.
func resultOf(res *mcp.CallToolResult) CallResult {
	var parts []string
	for _, c := range res.Content {
		switch v := c.(type) {
		case *mcp.TextContent:
			parts = append(parts, v.Text)
		case *mcp.EmbeddedResource:
			if v.Resource != nil && v.Resource.Text != "" {
				parts = append(parts, v.Resource.Text)
			} else {
				parts = append(parts, "[a binary resource was left out]")
			}
		case *mcp.ResourceLink:
			parts = append(parts, fmt.Sprintf("[resource: %s %s]", v.Name, v.URI))
		default:
			parts = append(parts, "[an image or audio part was left out]")
		}
	}
	text := strings.TrimSpace(strings.Join(parts, "\n\n"))
	if text == "" && res.StructuredContent != nil {
		if b, err := json.Marshal(res.StructuredContent); err == nil {
			text = string(b)
		}
	}
	text = strings.ToValidUTF8(text, "")
	out := CallResult{Text: text, IsError: res.IsError, Size: len(text)}
	if utf8.RuneCountInString(text) > MaxResultChars {
		out.Text = string([]rune(text)[:MaxResultChars]) + "\n\n[The result was cut: it was longer than " +
			fmt.Sprint(MaxResultChars) + " characters.]"
		out.Truncated = true
	}
	return out
}

// Error classes (stored health's error classes, plus the call outcomes).
const (
	ClassUnavailable   = "unavailable"
	ClassAuth          = "auth"
	ClassNotFound      = "not_found"
	ClassRateLimited   = "rate_limited"
	ClassBadRequest    = "bad_request"
	ClassBadResponse   = "bad_response"
	ClassConfig        = healthcheck.ClassConfig
	ClassTimeout       = "timeout"
	ClassTooLarge      = "too_large"
	ClassInputRequired = "input_required"
)

// Error is a failed exchange with a server: a class and a message safe to
// show admins (never a header value or a raw body).
type Error struct {
	Class      string
	HTTPStatus int
	Message    string
}

func (e *Error) Error() string { return e.Message }

// classify turns a transport or protocol error into an Error.
func (s *Service) classify(ctx context.Context, ex *exchange, err error) error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	status := ex.lastStatus()
	var rpc *jsonrpc.Error
	var netErr *url.Error
	switch {
	case errors.Is(err, ErrBlockedAddress) || strings.Contains(err.Error(), ErrBlockedAddress.Error()):
		return &Error{Class: ClassConfig, Message: "The server's address is not allowed (private, loopback or link-local, or a redirect)."}
	case errors.Is(err, ErrResponseTooLarge) || strings.Contains(err.Error(), ErrResponseTooLarge.Error()):
		return &Error{Class: ClassTooLarge, Message: fmt.Sprintf("The server's response was larger than %d bytes.", s.maxResponse())}
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return &Error{Class: ClassTimeout, Message: "The server didn't answer in time."}
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &Error{Class: ClassAuth, HTTPStatus: status, Message: fmt.Sprintf("The server refused the credentials (HTTP %d).", status)}
	case status == http.StatusNotFound:
		return &Error{Class: ClassNotFound, HTTPStatus: status, Message: "The server answered 404: check the URL."}
	case status == http.StatusTooManyRequests:
		return &Error{Class: ClassRateLimited, HTTPStatus: status, Message: "The server is rate limiting requests (HTTP 429)."}
	case status >= 400:
		return &Error{Class: ClassUnavailable, HTTPStatus: status, Message: fmt.Sprintf("The server answered HTTP %d.", status)}
	case errors.As(err, &netErr):
		return &Error{Class: ClassUnavailable, Message: "Couldn't reach the server: " + healthcheck.SafeMessage(netErr.Err.Error())}
	case errors.As(err, &rpc):
		return &Error{Class: ClassBadResponse, Message: "The server returned an error: " + healthcheck.SafeMessage(rpc.Message)}
	case errors.Is(err, io.ErrUnexpectedEOF):
		return &Error{Class: ClassBadResponse, Message: "The server's response was cut off."}
	}
	s.Log.WarnContext(ctx, "mcp server exchange failed", "err", err)
	return &Error{Class: ClassUnavailable, Message: "Couldn't reach the server: " + healthcheck.SafeMessage(err.Error())}
}
