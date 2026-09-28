package limits

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
)

// Setting is a key's platform default (nil = unlimited) and ceiling (nil =
// none).
type Setting struct {
	Default *int64 `json:"default"`
	Ceiling *int64 `json:"ceiling"`
}

// Overrides are a team's values per key; a missing key inherits.
type Overrides map[Key]int64

// Platform is the platform-wide configuration with every registered key.
type Platform struct {
	Settings  map[Key]Setting
	Custom    map[Key]bool // set by a platform admin rather than built in
	Revision  int64
	UpdatedAt time.Time
}

// Effective computes a key's limit for a team: override ?? default, capped
// by the ceiling. nil means unlimited.
func (p Platform) Effective(k Key, o Overrides) *int64 {
	st := p.Settings[k]
	v := st.Default
	if n, ok := o[k]; ok {
		v = &n
	}
	if st.Ceiling != nil && (v == nil || *v > *st.Ceiling) {
		v = st.Ceiling
	}
	if v == nil {
		return nil
	}
	n := *v
	return &n
}

// Set is one team's effective limits.
type Set struct {
	Platform  Platform
	Overrides Overrides
}

// Get returns the effective limit for k; nil = unlimited.
func (s Set) Get(k Key) *int64 { return s.Platform.Effective(k, s.Overrides) }

// parsePlatform reads stored settings over the built-in defaults. Unknown
// keys (for example from a newer release) are ignored.
func parsePlatform(raw json.RawMessage, builtins map[Key]*int64) (map[Key]Setting, map[Key]bool, error) {
	stored := map[string]Setting{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &stored); err != nil {
			return nil, nil, fmt.Errorf("platform limits: %w", err)
		}
	}
	settings, custom := map[Key]Setting{}, map[Key]bool{}
	for _, d := range registry {
		if st, ok := stored[string(d.Key)]; ok {
			settings[d.Key], custom[d.Key] = st, true
			continue
		}
		settings[d.Key] = Setting{Default: builtins[d.Key]}
	}
	return settings, custom, nil
}

func parseOverrides(raw json.RawMessage) (Overrides, error) {
	stored := map[string]int64{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &stored); err != nil {
			return nil, fmt.Errorf("team limits: %w", err)
		}
	}
	out := Overrides{}
	for k, v := range stored {
		if _, ok := Lookup(Key(k)); ok {
			out[Key(k)] = v
		}
	}
	return out, nil
}

// ---- errors ---------------------------------------------------------------------

// Error is a limit that stopped a request. It unwraps to an apperr.Error:
// 409 limit_reached for resource caps, 429 rate_limited for query rates,
// with details {limit, max, current}.
type Error struct {
	Def     Def
	Max     int64
	Current int64
	err     *apperr.Error
}

func (e *Error) Error() string { return e.err.Error() }

func (e *Error) Unwrap() error { return e.err }

func details(d Def, max, current int64) map[string]any {
	return map[string]any{"limit": string(d.Key), "max": max, "current": current}
}

// reached is a resource cap that a change would exceed.
func reached(d Def, max, current int64) *Error {
	var msg string
	switch {
	case max == 0:
		msg = fmt.Sprintf("%s are blocked for your team. Ask a platform admin if you need them.", d.Label)
		if d.Unit == UnitBytes {
			msg = "Storing documents is blocked for your team. Ask a platform admin if you need it."
		}
	case d.Unit == UnitBytes:
		msg = fmt.Sprintf("Your team has reached its storage limit of %s (%s used). Delete documents or ask a platform admin to raise the limit.",
			FormatBytes(max), FormatBytes(current))
	default:
		msg = fmt.Sprintf("Your team has reached its limit of %s. Ask a platform admin to raise it.", d.Format(max))
	}
	return &Error{Def: d, Max: max, Current: current, err: &apperr.Error{
		Status: http.StatusConflict, Code: "limit_reached", Message: msg, Details: details(d, max, current),
	}}
}

// Blocked reports a key set to 0 for a team (409 limit_reached).
func Blocked(k Key) *Error {
	d, _ := Lookup(k)
	return reached(d, 0, 0)
}

// rateLimited is a query rate or daily query cap that was reached.
func rateLimited(d Def, max, current int64, retry time.Duration) *Error {
	var msg string
	switch {
	case max == 0:
		msg = "Queries are blocked for your team. Ask a platform admin if you need them."
	case d.Period == PeriodDay:
		msg = fmt.Sprintf("Your team has used its %d queries for today. The limit resets at midnight UTC.", max)
	case d.Key == APIKeyQueriesPerMinute:
		msg = fmt.Sprintf("This API key is sending too many queries (limit: %d per minute). Try again in a few seconds.", max)
	case d.Key == UserQueriesPerMinute:
		msg = fmt.Sprintf("You're sending too many queries (limit: %d per minute). Try again in a few seconds.", max)
	default:
		msg = fmt.Sprintf("Your team is sending too many queries (limit: %d per minute). Try again in a few seconds.", max)
	}
	return &Error{Def: d, Max: max, Current: current, err: &apperr.Error{
		Status: http.StatusTooManyRequests, Code: "rate_limited", Message: msg,
		Details: details(d, max, current), RetryAfter: retry,
	}}
}

// quotaExceeded is a daily token quota that was reached.
func quotaExceeded(d Def, max, current int64, retry time.Duration) *Error {
	msg := fmt.Sprintf("Your team has used its %d chat tokens for today. The limit resets at midnight UTC.", max)
	if max == 0 {
		msg = "Chat is blocked for your team. Ask a platform admin if you need it."
	}
	return &Error{Def: d, Max: max, Current: current, err: &apperr.Error{
		Status: http.StatusTooManyRequests, Code: "quota_exceeded", Message: msg,
		Details: details(d, max, current), RetryAfter: retry,
	}}
}

// concurrentChats is a person with too many answers streaming at once.
func concurrentChats(d Def, max int64) *Error {
	msg := fmt.Sprintf("You already have %d answers in progress. Wait for one to finish.", max)
	if max == 0 {
		msg = "Chat is blocked for your team. Ask a platform admin if you need it."
	}
	return &Error{Def: d, Max: max, Current: max, err: &apperr.Error{
		Status: http.StatusTooManyRequests, Code: "rate_limited", Message: msg,
		Details: details(d, max, max), RetryAfter: 5 * time.Second,
	}}
}

// ---- validation -----------------------------------------------------------------

func invalid(format string, args ...any) error {
	return apperr.Invalid("invalid_limit", fmt.Sprintf(format, args...))
}

func label(d Def) string { return strings.ToLower(d.Label) }

// SettingChange sets one key's platform default and ceiling.
type SettingChange struct {
	Key Key
	Setting
}

// OverrideChange sets (Value non-nil) or removes (nil: inherit) a team override.
type OverrideChange struct {
	Key   Key
	Value *int64
}

// maxValue bounds stored values (they fit a Postgres bigint and JSON numbers).
const maxValue = int64(1) << 53

func checkValue(d Def, what string, v *int64) error {
	if v != nil && (*v < 0 || *v > maxValue) {
		return invalid("The %s for %s must be between 0 and %d", what, label(d), maxValue)
	}
	return nil
}

// ValidateSetting checks a platform default and ceiling.
func ValidateSetting(d Def, st Setting) error {
	if err := checkValue(d, "default", st.Default); err != nil {
		return err
	}
	if err := checkValue(d, "ceiling", st.Ceiling); err != nil {
		return err
	}
	if st.Ceiling != nil && (st.Default == nil || *st.Default > *st.Ceiling) {
		return invalid("The default for %s must be at most its ceiling (%s)", label(d), d.Format(*st.Ceiling))
	}
	return nil
}

// ValidateOverride checks a team override against the key's ceiling.
func ValidateOverride(d Def, st Setting, v *int64) error {
	if err := checkValue(d, "value", v); err != nil {
		return err
	}
	if v != nil && st.Ceiling != nil && *v > *st.Ceiling {
		return apperr.Invalid("above_ceiling",
			fmt.Sprintf("The value for %s is above the platform ceiling of %s", label(d), d.Format(*st.Ceiling)))
	}
	return nil
}

// StartOfDay is the start of now's UTC day, when daily limits reset.
func StartOfDay(now time.Time) time.Time {
	y, m, d := now.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// NextDay is the next UTC midnight after now.
func NextDay(now time.Time) time.Time { return StartOfDay(now).Add(24 * time.Hour) }
