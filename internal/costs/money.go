package costs

import (
	"math/big"
	"regexp"
	"strings"

	"github.com/ncecere/grounded/internal/apperr"
)

// Money is exact: amounts are big.Rat in Go, numeric(20,6) in Postgres and
// decimal strings with six decimals in the API. Floats are never used.

// Scale is the number of decimals stored and returned.
const Scale = 6

// amountRE is a non-negative decimal with at most 14 integer digits and six
// decimals (it fits numeric(20,6)).
var amountRE = regexp.MustCompile(`^[0-9]{1,14}(\.[0-9]{1,6})?$`)

// ParseAmount reads a non-negative decimal amount such as "12.5". field
// names it in the error.
func ParseAmount(s, field string) (*big.Rat, error) {
	s = strings.TrimSpace(s)
	if !amountRE.MatchString(s) {
		return nil, apperr.Invalid("invalid_amount", "The "+field+" must be a number of at most 14 digits with up to 6 decimals, such as 12.50")
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, apperr.Invalid("invalid_amount", "The "+field+" is not a number")
	}
	return r, nil
}

// mustRat reads an amount the database returned ("" is zero).
func mustRat(s string) *big.Rat {
	r, ok := new(big.Rat).SetString(s)
	if !ok || s == "" {
		return new(big.Rat)
	}
	return r
}

// Format writes an amount with Scale decimals, rounded half away from zero.
func Format(r *big.Rat) string {
	if r == nil {
		return Format(new(big.Rat))
	}
	return r.FloatString(Scale)
}

// optRat reads an optional stored amount ("" is none).
func optRat(s string) *big.Rat {
	if s == "" {
		return nil
	}
	return mustRat(s)
}

// optFormat formats an optional amount.
func optFormat(r *big.Rat) *string {
	if r == nil {
		return nil
	}
	s := Format(r)
	return &s
}

// PerUnits is how many units one price covers: a million tokens, or one
// request.
func PerUnits(unit string) int64 {
	switch unit {
	case UnitSystemOneRequests, UnitModeration:
		return 1
	}
	return 1_000_000
}

// Cost is quantity units at price (per PerUnits(unit) units).
func Cost(quantity int64, unit string, price *big.Rat) *big.Rat {
	c := new(big.Rat).SetInt64(quantity)
	c.Mul(c, price)
	return c.Quo(c, new(big.Rat).SetInt64(PerUnits(unit)))
}

// Percent is spent as a whole percentage of limit, rounded down (nil when
// the limit is zero or unset).
func Percent(spent, limit *big.Rat) *int {
	if limit == nil || limit.Sign() <= 0 {
		return nil
	}
	q := new(big.Rat).Quo(new(big.Rat).Mul(spent, big.NewRat(100, 1)), limit)
	n := new(big.Int).Quo(q.Num(), q.Denom())
	v := int(min(n.Int64(), 1_000_000))
	return &v
}
