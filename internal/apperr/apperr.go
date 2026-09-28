// Package apperr defines errors that carry an HTTP status, a stable machine
// code and a user-safe message. Domain services return them; the HTTP layer
// renders them as {"error": {"code", "message"}}. Any other error is a 500.
package apperr

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type Error struct {
	Status  int
	Code    string
	Message string
	// Details, when set, is rendered as error.details (structured context
	// such as {limit, max, current} for limit_reached).
	Details any
	// RetryAfter, when positive, is sent as the Retry-After header (429, 503).
	RetryAfter time.Duration
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func Invalid(code, message string) *Error { return New(http.StatusBadRequest, code, message) }

func Forbidden(message string) *Error { return New(http.StatusForbidden, "forbidden", message) }

func NotFound(code, message string) *Error { return New(http.StatusNotFound, code, message) }

func Conflict(code, message string) *Error { return New(http.StatusConflict, code, message) }

// Stale is returned when an If-Match revision no longer matches.
func Stale() *Error {
	return New(http.StatusPreconditionFailed, "revision_conflict",
		"Someone else changed this since you loaded it. Reload and try again.")
}

// As returns the *Error in err's chain, if any.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

// Postgres error codes we map to user-facing errors.
const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
)

// IsUniqueViolation reports whether err is a unique violation on constraint
// (any constraint if constraint is "").
func IsUniqueViolation(err error, constraint string) bool {
	return isPG(err, pgUniqueViolation, constraint)
}

// IsForeignKeyViolation reports whether err is a foreign-key violation.
func IsForeignKeyViolation(err error, constraint string) bool {
	return isPG(err, pgForeignKeyViolation, constraint)
}

func isPG(err error, code, constraint string) bool {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != code {
		return false
	}
	return constraint == "" || pg.ConstraintName == constraint
}
