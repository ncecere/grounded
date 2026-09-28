package costs

import (
	"context"
	"errors"
	"math/big"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Prices are dated (docs/costs.md §2): a change adds a row with an
// effective-from date, and each local day's usage is priced at the row in
// effect that day. Rows are never edited, so past spend doesn't change when a
// price does; a mistaken row can be deleted.

// kindUnits are the units priced for each model kind.
var kindUnits = map[string][]string{
	"chat":       {UnitChatIn, UnitChatOut},
	"embedding":  {UnitEmbed},
	"systemone":  {UnitSystemOneTokens, UnitSystemOneRequests},
	"moderation": {UnitModeration},
	"vision":     {UnitVisionIn, UnitVisionOut},
}

// PricedUnits are every priced ledger kind.
var PricedUnits = []string{UnitChatIn, UnitChatOut, UnitEmbed, UnitSystemOneTokens, UnitSystemOneRequests, UnitModeration, UnitVisionIn, UnitVisionOut}

// UnitsFor lists the units a model of this kind is priced in (none for
// kinds that aren't priced, such as rerank).
func UnitsFor(kind string) []string { return append([]string(nil), kindUnits[kind]...) }

// Category groups units for reports: chat, embedding, systemone, moderation, ocr.
func Category(unit string) string {
	switch unit {
	case UnitChatIn, UnitChatOut:
		return "chat"
	case UnitEmbed:
		return "embedding"
	case UnitSystemOneTokens, UnitSystemOneRequests:
		return "systemone"
	case UnitVisionIn, UnitVisionOut:
		return "ocr"
	}
	return "moderation"
}

// Price is one dated price row.
type Price struct {
	ID            uuid.UUID
	ModelID       uuid.UUID
	Unit          string
	Price         *big.Rat
	EffectiveFrom Day
	CreatedBy     uuid.NullUUID
	CreatedByName string
	CreatedAt     time.Time
}

type priceKey struct {
	model uuid.UUID
	unit  string
}

// PriceBook finds the price in effect on a day.
type PriceBook map[priceKey][]Price // newest effective date first

// NewPriceBook indexes price rows.
func NewPriceBook(rows []Price) PriceBook {
	b := PriceBook{}
	for _, p := range rows {
		k := priceKey{p.ModelID, p.Unit}
		b[k] = append(b[k], p)
	}
	for _, list := range b {
		sort.SliceStable(list, func(i, j int) bool { return list[i].EffectiveFrom.After(list[j].EffectiveFrom) })
	}
	return b
}

// At returns the price of a model's unit on a local day (ok false:
// unpriced).
func (b PriceBook) At(model uuid.UUID, unit string, day Day) (Price, bool) {
	for _, p := range b[priceKey{model, unit}] {
		if !p.EffectiveFrom.After(day) {
			return p, true
		}
	}
	return Price{}, false
}

func priceFrom(id, model uuid.UUID, unit, price string, from time.Time, by uuid.NullUUID, at time.Time) Price {
	return Price{ID: id, ModelID: model, Unit: unit, Price: mustRat(price), EffectiveFrom: from, CreatedBy: by, CreatedAt: at}
}

// priceBook loads every price, cached until a change (generation).
func (s *Service) priceBook(ctx context.Context, generation int64) (PriceBook, error) {
	s.mu.Lock()
	pc := s.prices
	s.mu.Unlock()
	if pc != nil && pc.generation == generation {
		return pc.book, nil
	}
	rows, err := s.q.ListAllModelPrices(ctx)
	if err != nil {
		return nil, err
	}
	list := make([]Price, len(rows))
	for i, r := range rows {
		list[i] = priceFrom(r.ID, r.ModelID, r.Unit, r.Price, r.EffectiveFrom.Time, r.CreatedBy, r.CreatedAt)
	}
	book := NewPriceBook(list)
	s.mu.Lock()
	s.prices = &priceCache{generation: generation, book: book}
	s.mu.Unlock()
	return book, nil
}

type priceCache struct {
	generation int64
	book       PriceBook
}

// UnitPrice is a unit's price in effect (Price nil: unpriced).
type UnitPrice struct {
	Unit          string
	Price         *big.Rat
	EffectiveFrom *Day
}

// ModelPricing is a model's current prices and their history.
type ModelPricing struct {
	Model    dbgen.Model
	Currency string
	Units    []string
	Current  []UnitPrice
	History  []Price
}

// current prices of a model today, per unit.
func currentPrices(book PriceBook, model uuid.UUID, units []string, today Day) (out []UnitPrice, unpriced bool) {
	out = []UnitPrice{}
	for _, u := range units {
		up := UnitPrice{Unit: u}
		if p, ok := book.At(model, u, today); ok {
			d := p.EffectiveFrom
			up.Price, up.EffectiveFrom = p.Price, &d
		} else {
			unpriced = true
		}
		out = append(out, up)
	}
	return out, unpriced
}

var errNoModel = apperr.NotFound("model_not_found", "Model not found")

func (s *Service) model(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (dbgen.Model, error) {
	m, err := q.GetModel(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return m, errNoModel
	}
	return m, err
}

// ModelPrices returns a model's pricing (platform admins and auditors).
func (s *Service) ModelPrices(ctx context.Context, a authz.Actor, modelID uuid.UUID) (ModelPricing, error) {
	if !canRead(a) {
		return ModelPricing{}, errReadOnly
	}
	m, err := s.model(ctx, s.q, modelID)
	if err != nil {
		return ModelPricing{}, err
	}
	st, err := s.current(ctx)
	if err != nil {
		return ModelPricing{}, err
	}
	rows, err := s.q.ListModelPrices(ctx, modelID)
	if err != nil {
		return ModelPricing{}, err
	}
	out := ModelPricing{Model: m, Currency: st.Currency, Units: UnitsFor(m.Kind), History: make([]Price, len(rows))}
	for i, r := range rows {
		out.History[i] = priceFrom(r.ID, r.ModelID, r.Unit, r.Price, r.EffectiveFrom.Time, r.CreatedBy, r.CreatedAt)
		out.History[i].CreatedByName = r.CreatedByName
	}
	out.Current, _ = currentPrices(NewPriceBook(out.History), m.ID, out.Units, DayOf(s.now(), st.Location()))
	return out, nil
}

// PriceInput is one unit's new price.
type PriceInput struct {
	Unit  string
	Price string
}

func checkPriceInputs(kind string, in []PriceInput) ([]*big.Rat, error) {
	units := kindUnits[kind]
	if len(units) == 0 {
		return nil, apperr.Invalid("not_priced", "Models of this kind aren't priced")
	}
	if len(in) == 0 {
		return nil, apperr.Invalid("invalid_prices", "Give at least one price")
	}
	seen := map[string]bool{}
	out := make([]*big.Rat, len(in))
	for i, p := range in {
		ok := false
		for _, u := range units {
			ok = ok || u == p.Unit
		}
		if !ok {
			return nil, apperr.Invalid("invalid_unit", "A "+kind+" model isn't priced per "+p.Unit)
		}
		if seen[p.Unit] {
			return nil, apperr.Invalid("invalid_prices", "Each unit may appear once: "+p.Unit)
		}
		seen[p.Unit] = true
		r, err := ParseAmount(p.Price, "price")
		if err != nil {
			return nil, err
		}
		out[i] = r
	}
	return out, nil
}

// AddPrices adds dated prices for a model's units (platform admins).
// Audited as costs.price_add. A date may be in the past, to price usage
// already recorded.
func (s *Service) AddPrices(ctx context.Context, a authz.Actor, modelID uuid.UUID, from Day, in []PriceInput) (ModelPricing, error) {
	if !canWrite(a) {
		return ModelPricing{}, errAdminOnly
	}
	m, err := s.model(ctx, s.q, modelID)
	if err != nil {
		return ModelPricing{}, err
	}
	prices, err := checkPriceInputs(m.Kind, in)
	if err != nil {
		return ModelPricing{}, err
	}
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		after := map[string]any{}
		for i, p := range in {
			_, err := q.InsertModelPrice(ctx, dbgen.InsertModelPriceParams{
				ModelID: modelID, Unit: p.Unit, Price: Format(prices[i]), EffectiveFrom: pgDate(from), CreatedBy: by(a),
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.Conflict("price_exists", "A "+p.Unit+" price from "+from.Format(time.DateOnly)+
					" already exists. Delete it first, or choose another date.")
			} else if err != nil {
				return err
			}
			after[p.Unit] = Format(prices[i])
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.price_add", "model", modelID.String())
		e.After = map[string]any{"model": m.Key, "effectiveFrom": from.Format(time.DateOnly), "prices": after}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return ModelPricing{}, err
	}
	s.changed(ctx, uuid.NullUUID{})
	return s.ModelPrices(ctx, a, modelID)
}

// DeletePrice deletes a mistaken price row (platform admins). Audited as
// costs.price_delete.
func (s *Service) DeletePrice(ctx context.Context, a authz.Actor, modelID, priceID uuid.UUID) error {
	if !canWrite(a) {
		return errAdminOnly
	}
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		p, err := q.GetModelPrice(ctx, dbgen.GetModelPriceParams{ID: priceID, ModelID: modelID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("price_not_found", "Price not found")
		} else if err != nil {
			return err
		}
		if _, err := q.DeleteModelPrice(ctx, dbgen.DeleteModelPriceParams{ID: priceID, ModelID: modelID}); err != nil {
			return err
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.price_delete", "model", modelID.String())
		e.Before = map[string]any{"priceId": p.ID, "unit": p.Unit, "price": p.Price, "effectiveFrom": p.EffectiveFrom.Time.Format(time.DateOnly)}
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.changed(ctx, uuid.NullUUID{})
	}
	return err
}

// ModelPriceSummary is one model's current prices (the Prices tab).
type ModelPriceSummary struct {
	Model    dbgen.Model
	Current  []UnitPrice
	Unpriced bool
}

// PriceList is every priced model's current prices.
type PriceList struct {
	Currency string
	Items    []ModelPriceSummary
}

// Prices lists every model of a priced kind with its current prices
// (platform admins and auditors).
func (s *Service) Prices(ctx context.Context, a authz.Actor) (PriceList, error) {
	if !canRead(a) {
		return PriceList{}, errReadOnly
	}
	st, err := s.current(ctx)
	if err != nil {
		return PriceList{}, err
	}
	book, err := s.priceBook(ctx, st.Generation)
	if err != nil {
		return PriceList{}, err
	}
	models, err := s.q.ListModels(ctx, dbgen.ListModelsParams{})
	if err != nil {
		return PriceList{}, err
	}
	today := DayOf(s.now(), st.Location())
	out := PriceList{Currency: st.Currency, Items: []ModelPriceSummary{}}
	for _, m := range models {
		units := UnitsFor(m.Kind)
		if len(units) == 0 {
			continue
		}
		cur, unpriced := currentPrices(book, m.ID, units, today)
		out.Items = append(out.Items, ModelPriceSummary{Model: m, Current: cur, Unpriced: unpriced})
	}
	return out, nil
}
