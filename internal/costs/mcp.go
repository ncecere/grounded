package costs

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// MCP servers are priced per call (docs/mcp-client.md, "Costs"): a dated
// mcp_calls price whose model_id is the server. Without a price, calls are
// counted but cost nothing (the report marks them unpriced).

// MCPServerPrice is a server's per-call price in effect today (nil:
// unpriced).
func (s *Service) MCPServerPrice(ctx context.Context, serverID uuid.UUID) (*big.Rat, error) {
	st, err := s.current(ctx)
	if err != nil {
		return nil, err
	}
	book, err := s.priceBook(ctx, st.Generation)
	if err != nil {
		return nil, err
	}
	if p, ok := book.At(serverID, UnitMCPCalls, DayOf(s.now(), st.Location())); ok {
		return p.Price, nil
	}
	return nil, nil
}

// SetMCPServerPrice sets a server's per-call price from today (platform
// time zone); a price already set today is replaced, earlier days keep
// theirs. The caller has checked that the actor may change the server.
// Audited as costs.price_add.
func (s *Service) SetMCPServerPrice(ctx context.Context, a authz.Actor, serverID uuid.UUID, serverName, price string) error {
	if !canWrite(a) {
		return errAdminOnly
	}
	r, err := ParseAmount(price, "pricePerCall")
	if err != nil {
		return err
	}
	st, err := s.current(ctx)
	if err != nil {
		return err
	}
	today := DayOf(s.now(), st.Location())
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM model_prices WHERE model_id = $1 AND unit = $2 AND effective_from = $3`,
			serverID, UnitMCPCalls, pgDate(today)); err != nil {
			return err
		}
		if _, err := q.InsertModelPrice(ctx, dbgen.InsertModelPriceParams{ModelID: serverID, Unit: UnitMCPCalls, Price: Format(r),
			EffectiveFrom: pgDate(today), CreatedBy: by(a)}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.price_add", "mcp_server", serverID.String())
		e.After = map[string]any{"mcpServer": serverName, "effectiveFrom": today.Format(time.DateOnly), "prices": map[string]any{UnitMCPCalls: Format(r)}}
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.changed(ctx, uuid.NullUUID{})
	}
	return err
}

// ClearMCPServerPrice removes a server's per-call prices, so its calls are
// unpriced again, past ones included (a price set by mistake; dated rows
// can't say "unpriced from today"). The caller has checked that the actor may
// change the server. Audited as costs.price_delete; nothing to remove is a
// no-op.
func (s *Service) ClearMCPServerPrice(ctx context.Context, a authz.Actor, serverID uuid.UUID, serverName string) error {
	if !canWrite(a) {
		return errAdminOnly
	}
	removed := 0
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM model_prices WHERE model_id = $1 AND unit = $2 RETURNING price::text, effective_from`,
			serverID, UnitMCPCalls)
		if err != nil {
			return err
		}
		var prices []map[string]any
		for rows.Next() {
			var price string
			var from time.Time
			if err := rows.Scan(&price, &from); err != nil {
				rows.Close()
				return err
			}
			prices = append(prices, map[string]any{"price": price, "effectiveFrom": from.Format(time.DateOnly)})
		}
		rows.Close()
		if err := rows.Err(); err != nil || len(prices) == 0 {
			return err
		}
		removed = len(prices)
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.price_delete", "mcp_server", serverID.String())
		e.Before = map[string]any{"mcpServer": serverName, "unit": UnitMCPCalls, "prices": prices}
		return audit.Record(ctx, q, e)
	})
	if err == nil && removed > 0 {
		s.changed(ctx, uuid.NullUUID{})
	}
	return err
}
