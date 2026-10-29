package httpx

import (
	"errors"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"
)

// formatProblem recognises a value of the right JSON kind in the wrong format
// (#146): the generated request types parse emails, dates and ids while
// decoding, so these failures never reach a handler's own validation. Each gets
// its own code and says which format is expected. encoding/json does not report
// the field for these errors, so the message names the format, not the field.
func formatProblem(err error) (code, message string, ok bool) {
	var parse *time.ParseError
	switch {
	case errors.Is(err, openapi_types.ErrValidationEmail):
		return "invalid_email", "Enter a valid email address, like name@example.edu", true
	case errors.As(err, &parse):
		return "invalid_date", "Dates must be RFC 3339 date-times like 2026-01-31T09:00:00Z, or dates like 2026-01-31", true
	case strings.HasPrefix(err.Error(), "invalid UUID"): // github.com/google/uuid has no exported error for a bad format
		return "invalid_id", "IDs must be UUIDs, like 6b1f5c4e-8a3a-4e6a-9d0f-0c6f1e2a3b4c", true
	}
	return "", "", false
}
