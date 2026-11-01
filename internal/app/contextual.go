package app

import (
	"context"
	"math/big"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
)

// wireContextual connects opt-in context generation after the core services and
// knowledge workflows exist. Its settings alone never start generation.
func wireContextual(s *Services, cfg config.Config) error {
	counter, err := chunk.NewTokenCounter()
	if err != nil {
		return err
	}
	s.Contextual = contextual.New(s.pool, s.Teams, counter, s.log)
	s.Contextual.Enabled = func() bool { return cfg.ContextualChunks }
	s.Contextual.Price = costsPricer(s.Costs)
	s.Contextual.LimitRaised = func(ctx context.Context, team uuid.NullUUID) {
		if _, err := ingest.WakeContextWaiting(ctx, s.pool, s.jobs, team); err != nil {
			s.log.WarnContext(ctx, "could not wake documents waiting for a contextual chunks limit", "err", err)
		}
	}
	s.ProfileMigrations.Contextual = s.Contextual
	return nil
}

// costsPricer gives the contextual-chunks estimate a model's chat prices: per million input and output tokens, since the calls are recorded
// as chat tokens of the model (docs/contextual-chunks.md section 5). A missing price is reported as unknown, never as zero.
func costsPricer(c *costs.Service) contextual.Pricer {
	return func(ctx context.Context, a authz.Actor, modelID uuid.UUID) (contextual.Price, error) {
		mp, err := c.ModelPrices(ctx, a, modelID)
		if err != nil {
			return contextual.Price{}, err
		}
		p := contextual.Price{Currency: mp.Currency}
		var in, out *big.Rat
		for _, u := range mp.Current {
			switch u.Unit {
			case costs.UnitChatIn:
				in = u.Price
			case costs.UnitChatOut:
				out = u.Price
			}
		}
		p.InputPerMillion, p.OutputPerMillion, p.Known = in, out, in != nil && out != nil
		return p, nil
	}
}

// contextGate says whether a team may spend model tokens on contextual chunks now: its monthly budget (when enforced) and its daily
// chat-token quota, which these calls count in. Either one waits (it is not a failure); a check that cannot be made waits too.
func contextGate(c *costs.Service, l *limits.Service) func(ctx context.Context, team uuid.UUID) *contextual.Wait {
	return func(ctx context.Context, team uuid.UUID) *contextual.Wait {
		if err := c.Check(ctx, team); err != nil {
			msg := "Waiting for the team's monthly budget before writing contextual-chunk descriptions. It continues when the budget is raised or next month."
			if !costs.IsExhausted(err) {
				msg = "The team's budget could not be checked; contextual-chunk descriptions wait and try again."
			}
			return &contextual.Wait{Code: "monthly_budget", Until: time.Now().Add(10 * time.Minute), Message: msg}
		}
		if err := l.CheckChatQuota(ctx, team); err != nil {
			now := l.Now()
			return &contextual.Wait{Code: "daily_chat_tokens", Until: limits.NextDay(now),
				Message: "Waiting for the team's daily chat-token quota before writing contextual-chunk descriptions. It continues after midnight UTC or when the quota is raised."}
		}
		return nil
	}
}
