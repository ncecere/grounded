// Package httpx holds the HTTP conventions shared by every handler:
// the JSON envelopes, request decoding, request IDs and client IP resolution.
//
// Success responses are {"data": ...}; errors are
// {"error": {"code": "...", "message": "..."}}.
package httpx

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
)

type envelope struct {
	Data any `json:"data"`
}

type errorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// JSON writes a success envelope.
func JSON(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, envelope{Data: data})
}

// ErrorWriter formats a safe client-facing error (native, OpenAI or JSON-RPC).
type ErrorWriter func(http.ResponseWriter, int, string, string)

// Error writes an error envelope. Messages must be safe to show to users.
func Error(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: ErrorDetail{Code: code, Message: message}})
}

// ErrorDetails writes an error envelope with structured details.
func ErrorDetails(w http.ResponseWriter, status int, code, message string, details any) {
	writeJSON(w, status, errorBody{Error: ErrorDetail{Code: code, Message: message, Details: details}})
}

// StatusClientClosedRequest is the status recorded for a request whose
// client went away before the answer was ready (nginx's 499). It isn't a
// server error: it stays out of the 5xx metrics and the error SLO.
const StatusClientClosedRequest = 499

// ClientGone reports whether the request's client disconnected (or
// cancelled it), as opposed to a deadline or a server-side failure.
func ClientGone(r *http.Request) bool {
	return errors.Is(r.Context().Err(), context.Canceled)
}

// Internal logs err with the request ID and writes a generic 500. When the
// client has gone away the failure is almost always the cancellation
// itself, so it is logged at info as a client cancellation and recorded
// as 499 instead.
func Internal(w http.ResponseWriter, r *http.Request, err error) {
	InternalWith(w, r, err, Error)
}

// InternalWith keeps Internal's logging, redaction and cancellation semantics,
// but writes the endpoint's error envelope, including failures in shared auth.
func InternalWith(w http.ResponseWriter, r *http.Request, err error, fail ErrorWriter) {
	if ClientGone(r) {
		slog.InfoContext(r.Context(), "client closed request", "err", err, "request_id", RequestID(r.Context()), "path", r.URL.Path)
		fail(w, StatusClientClosedRequest, "client_closed_request", "The request was cancelled.")
		return
	}
	slog.ErrorContext(r.Context(), "internal error", "err", err, "request_id", RequestID(r.Context()), "path", r.URL.Path)
	fail(w, http.StatusInternalServerError, "internal", "Something went wrong. Include the request ID if you report this.")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// MaxBodyBytes is the default limit for JSON request bodies.
const MaxBodyBytes = 1 << 20

// NULMessage is what a person is told when text holds U+0000, which
// Postgres text columns cannot store (the insert would fail as a 500).
const NULMessage = "Text can't contain the NUL character (U+0000)."

// JSONHasNUL reports whether a JSON document has a string, or an object key,
// holding U+0000: the escape \u0000. (A raw 0x00 byte is not valid JSON and
// the decoder refuses it.) It follows string and escape state, so the text
// "\\u0000" (an escaped backslash, then u0000) is not a NUL.
func JSONHasNUL(b []byte) bool {
	inString := false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if !inString {
			inString = c == '"'
			continue
		}
		switch c {
		case '"':
			inString = false
		case '\\':
			if i+5 < len(b) && b[i+1] == 'u' && string(b[i+2:i+6]) == "0000" {
				return true
			}
			i++ // the escaped character is never a quote or a backslash that starts another escape
		}
	}
	return false
}

// BodyReadTimeout is how long a client has, once its headers are in, to send a JSON body (at most MaxBodyBytes). A client that sends part of
// a body and stops would otherwise hold its connection and a goroutine open for as long as it likes (the server has a header timeout, and no
// write timeout because chat streams).
var BodyReadTimeout = 30 * time.Second

// ReadBody reads a request body of at most limit bytes, giving the client BodyReadTimeout to send it. The deadline is lifted again as soon
// as the body has been read, so nothing later (a long chat stream) can meet it. (net/http also clears it when it starts watching for a
// disconnect, but not on every path; this is the safeguard.)
func ReadBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(BodyReadTimeout))
	defer func() { _ = rc.SetReadDeadline(time.Time{}) }()
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if IsBodyTimeout(err) {
		// Close after the answer: left open, the server would first wait for the rest of the body it will never get.
		w.Header().Set("Connection", "close")
	}
	return raw, err
}

// IsBodyTimeout reports a body that did not arrive within BodyReadTimeout.
func IsBodyTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// decodeProblem says what is wrong with a body that did not decode, naming the field when there is one and never a Go type: an unknown field,
// a value of the wrong kind, a body that is empty or not JSON. The code stays invalid_json (clients match on it).
func decodeProblem(err error) string {
	var syntax *json.SyntaxError
	var typed *json.UnmarshalTypeError
	switch {
	case errors.Is(err, io.EOF):
		return "The request body is empty: send a JSON object"
	case errors.As(err, &syntax) || errors.Is(err, io.ErrUnexpectedEOF):
		return "The request body is not valid JSON"
	case errors.As(err, &typed) && typed.Field != "":
		return fmt.Sprintf("Field %q must be %s", clip(typed.Field, 80), jsonKind(typed.Type))
	case strings.HasPrefix(err.Error(), "json: unknown field "): // encoding/json has no typed error for it
		return "Unknown field " + strconv.Quote(clip(strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`), 60))
	}
	return "The request body does not fit this operation: check its fields"
}

// jsonKind names what a Go type holds, as a person sending JSON would say it.
func jsonKind(t reflect.Type) string {
	if t == nil {
		return "a different kind of value"
	}
	switch t.Kind() {
	case reflect.String:
		return "text"
	case reflect.Bool:
		return "true or false"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "a whole number"
	case reflect.Float32, reflect.Float64:
		return "a number"
	case reflect.Slice, reflect.Array:
		return "a list"
	case reflect.Struct, reflect.Map:
		return "an object"
	}
	return "a different kind of value"
}

// clip cuts s to n characters, so a long field name sent by a client is never echoed whole.
func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// Decode reads exactly one JSON object into dst, rejecting unknown fields.
// On failure it writes a 400 and returns false.
func Decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		Error(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send application/json")
		return false
	}
	raw, err := ReadBody(w, r, MaxBodyBytes)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			Error(w, http.StatusRequestEntityTooLarge, "body_too_large", "Request body is too large")
			return false
		}
		if IsBodyTimeout(err) {
			Error(w, http.StatusRequestTimeout, "request_timeout", "The request body took too long to arrive")
			return false
		}
		Error(w, http.StatusBadRequest, "invalid_json", "Request body could not be read")
		return false
	}
	if JSONHasNUL(raw) {
		Error(w, http.StatusBadRequest, "invalid_text", NULMessage)
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if code, msg, ok := formatProblem(err); ok {
			Error(w, http.StatusBadRequest, code, msg)
			return false
		}
		Error(w, http.StatusBadRequest, "invalid_json", decodeProblem(err))
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		Error(w, http.StatusBadRequest, "invalid_json", "Request body must contain a single JSON object")
		return false
	}
	return true
}

type requestIDKey struct{}

// WithRequestID stores a request ID in the context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID returns the request ID, or "".
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// NewID returns a random URL-safe identifier with n bytes of entropy.
func NewID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ClientIP returns the caller's address. X-Forwarded-For is only honoured when
// the direct peer is a trusted proxy; the right-most untrusted hop wins so a
// client cannot spoof its address by sending its own header.
func ClientIP(r *http.Request, trusted []netip.Prefix) string {
	peer := remoteAddr(r)
	if !peer.IsValid() {
		return ""
	}
	if !isTrusted(peer, trusted) {
		return peer.String()
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		addr = addr.Unmap()
		if !isTrusted(addr, trusted) {
			return addr.String()
		}
	}
	return peer.String()
}

func remoteAddr(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return addr.Unmap()
}

func isTrusted(addr netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// Fail renders an *apperr.Error with its status and code; anything else is
// logged and becomes a generic 500.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	if e, ok := apperr.As(err); ok {
		if e.RetryAfter > 0 {
			secs := int((e.RetryAfter + time.Second - 1) / time.Second)
			w.Header().Set("Retry-After", strconv.Itoa(max(secs, 1)))
		}
		if e.Details != nil {
			ErrorDetails(w, e.Status, e.Code, e.Message, e.Details)
			return
		}
		Error(w, e.Status, e.Code, e.Message)
		return
	}
	Internal(w, r, err)
}
