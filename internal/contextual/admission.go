package contextual

import (
	"errors"
	"math/big"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Admission is explicit source/build and source/UTC-day headroom. Amounts are
// exact decimal configured-price quantities, never an external invoice promise.
type Admission struct {
	MaxTokens, MaxTokensPerDay int64
	MaxAmount, MaxAmountPerDay string
	Currency                   string
}

const MaxAdmissionTokens int64 = 1_000_000_000

var admissionCurrency = regexp.MustCompile(`^[A-Z]{3}$`)

func validateAdmission(a *Admission, enabled bool) error {
	if a == nil {
		if enabled {
			return apperr.Invalid("contextual_admission_required", "Configure explicit token and spend admission limits before enabling contextual chunks")
		}
		return nil
	}
	if a.MaxTokens < 1 || a.MaxTokens > MaxAdmissionTokens || a.MaxTokensPerDay < 1 || a.MaxTokensPerDay > MaxAdmissionTokens {
		return apperr.Invalid("invalid_contextual_tokens", "Contextual token limits must be between 1 and 1000000000")
	}
	if !admissionCurrency.MatchString(a.Currency) {
		return apperr.Invalid("invalid_contextual_currency", "The admission currency must be a three-letter uppercase code")
	}
	for _, amount := range []string{a.MaxAmount, a.MaxAmountPerDay} {
		n, err := costs.ParseAmount(amount, "contextual admission amount")
		if err != nil {
			return err
		}
		if n.Sign() <= 0 {
			return apperr.Invalid("invalid_contextual_amount", "Contextual spend admission limits must be positive")
		}
	}
	return nil
}

func numericString(n pgtype.Numeric) string {
	v, err := n.Value()
	if err != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func admissionOf(r dbgen.SourceContextual) *Admission {
	if r.MaxTokens == nil || r.MaxTokensPerDay == nil || r.Currency == nil {
		return nil
	}
	return &Admission{MaxTokens: *r.MaxTokens, MaxTokensPerDay: *r.MaxTokensPerDay,
		MaxAmount: numericString(r.MaxAmount), MaxAmountPerDay: numericString(r.MaxAmountPerDay), Currency: *r.Currency}
}

func applyAdmission(p *dbgen.UpdateSourceContextualParams, a *Admission) {
	if a != nil {
		p.MaxTokens, p.MaxTokensPerDay = &a.MaxTokens, &a.MaxTokensPerDay
		p.MaxAmount, p.MaxAmountPerDay, p.Currency = &a.MaxAmount, &a.MaxAmountPerDay, &a.Currency
	}
}

func admissionRaised(old, next *Admission) bool {
	if next == nil {
		return false
	}
	if old == nil || next.MaxTokens > old.MaxTokens || next.MaxTokensPerDay > old.MaxTokensPerDay {
		return true
	}
	for _, pair := range [][2]string{{old.MaxAmount, next.MaxAmount}, {old.MaxAmountPerDay, next.MaxAmountPerDay}} {
		a, aok := new(big.Rat).SetString(pair[0])
		b, bok := new(big.Rat).SetString(pair[1])
		if aok && bok && b.Cmp(a) > 0 {
			return true
		}
	}
	return false
}

// ceilAmount rounds up to the database's six decimals. Many individually tiny
// requests must not become free because their rounded-to-nearest price is zero.
func ceilAmount(n *big.Rat) string {
	scaled := new(big.Rat).Mul(n, big.NewRat(1_000_000, 1))
	whole, rem := new(big.Int), new(big.Int)
	whole.QuoRem(scaled.Num(), scaled.Denom(), rem)
	if rem.Sign() > 0 {
		whole.Add(whole, big.NewInt(1))
	}
	return new(big.Rat).SetFrac(whole, big.NewInt(1_000_000)).FloatString(6)
}

func admissionAmount(in, out int64, inputPrice, outputPrice string) (string, error) {
	if in < 0 || out < 0 {
		return "", errors.New("negative contextual admission usage")
	}
	ip, err := costs.ParseAmount(inputPrice, "input price")
	if err != nil {
		return "", err
	}
	op, err := costs.ParseAmount(outputPrice, "output price")
	if err != nil {
		return "", err
	}
	n := new(big.Rat).Add(new(big.Rat).Mul(big.NewRat(in, 1), ip), new(big.Rat).Mul(big.NewRat(out, 1), op))
	n.Quo(n, big.NewRat(1_000_000, 1))
	return ceilAmount(n), nil
}

// AdmissionLimit is a reached window; it waits under either failure policy.
// Unwrap preserves the existing ErrCapReached classification for callers.
type AdmissionLimit struct {
	Daily bool
	Kind  string
	Until time.Time
}

func (e *AdmissionLimit) Error() string {
	period := "build"
	if e.Daily {
		period = "UTC-day"
	}
	return "the source's contextual " + period + " " + e.Kind + " admission limit is reached"
}
func (e *AdmissionLimit) Unwrap() error { return ErrCapReached }

func checkAdmission(a Admission, row dbgen.ContextualAdmissionUsageRow, calls, dailyCalls int, build bool, tokens int64, amount string, at time.Time) error {
	if row.OtherCurrency != 0 {
		return &Wait{Code: "contextual_currency", Message: "Contextual admission waits because this window contains a different configured price currency"}
	}
	check := func(daily bool, usedCalls, usedTokens int64, usedAmount string, capCalls int, capTokens int64, capAmount string) error {
		limit := &AdmissionLimit{Daily: daily}
		if daily {
			y, m, d := at.UTC().Date()
			limit.Until = time.Date(y, m, d+1, 0, 0, 0, 0, time.UTC)
		}
		switch {
		case usedCalls >= int64(capCalls):
			limit.Kind = "calls"
		case tokens > capTokens || usedTokens > capTokens-tokens:
			limit.Kind = "tokens"
		default:
			used, ok := new(big.Rat).SetString(usedAmount)
			add, aok := new(big.Rat).SetString(amount)
			cap, cok := new(big.Rat).SetString(capAmount)
			if !ok || !aok || !cok {
				return errors.New("invalid stored contextual admission amount")
			}
			if used.Add(used, add).Cmp(cap) <= 0 {
				return nil
			}
			limit.Kind = "configured-price spend"
		}
		return limit
	}
	if build {
		if err := check(false, row.BuildCalls, row.BuildTokens, row.BuildAmount, calls, a.MaxTokens, a.MaxAmount); err != nil {
			return err
		}
	}
	return check(true, row.DayCalls, row.DayTokens, row.DayAmount, dailyCalls, a.MaxTokensPerDay, a.MaxAmountPerDay)
}
