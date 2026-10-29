package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// #146: a value of the right JSON kind in the wrong format (an email, a date
// or an id) says which format was expected, with its own code, instead of the
// generic invalid_json "does not fit this operation".
func TestDecodeNamesFormatProblems(t *testing.T) {
	type body struct {
		Email openapi_types.Email `json:"email"`
		From  *time.Time          `json:"from"`
		Day   *openapi_types.Date `json:"day"`
		ID    *uuid.UUID          `json:"id"`
	}
	for _, tc := range []struct{ in, code, want string }{
		{`{"email":"not-an-email"}`, "invalid_email", "email address"},
		{`{"from":"notadate"}`, "invalid_date", "RFC 3339"},
		{`{"day":"31/01/2026"}`, "invalid_date", "2026-01-31"},
		{`{"id":"not-a-uuid"}`, "invalid_id", "UUID"},
	} {
		t.Run(tc.in, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/", strings.NewReader(tc.in))
			r.Header.Set("Content-Type", "application/json")
			var b body
			if Decode(w, r, &b) {
				t.Fatal("accepted")
			}
			var env struct {
				Error struct{ Code, Message string }
			}
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusBadRequest || env.Error.Code != tc.code || !strings.Contains(env.Error.Message, tc.want) {
				t.Fatalf("got %d %s", w.Code, w.Body)
			}
		})
	}
	// Valid values still decode.
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"email":"a@example.edu","from":"2026-01-31T00:00:00Z","day":"2026-01-31","id":"6b1f5c4e-8a3a-4e6a-9d0f-0c6f1e2a3b4c"}`))
	var ok body
	if !Decode(w, r, &ok) {
		t.Fatalf("valid formats refused: %s", w.Body)
	}
}
