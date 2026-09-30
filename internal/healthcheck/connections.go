package healthcheck

import (
	"context"
	"fmt"
	"net/http"
	"slices"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ConnectionChecker tests each enabled connection once per run with
// catalog.ProbeConnectionFree (GET /models; for a SystemOne service, only
// whether its endpoint answers) and derives the health of its enabled
// models from that result without calling them: a scheduled run sends no
// completion, embedding or SystemOne question, so it costs nothing
// (docs/operations/health.md).
type ConnectionChecker struct {
	Queries *dbgen.Queries
	// Probe tests a connection (catalog.Service.ProbeConnectionFree).
	Probe func(ctx context.Context, id uuid.UUID) (catalog.ConnectionTest, error)
}

// Targets returns one target per enabled connection, covering its enabled
// models. Its key is the connection, so a run probes a connection once.
func (c *ConnectionChecker) Targets(ctx context.Context) ([]Target, error) {
	conns, err := c.Queries.ListConnections(ctx)
	if err != nil {
		return nil, err
	}
	models, err := c.Queries.ListModels(ctx, dbgen.ListModelsParams{})
	if err != nil {
		return nil, err
	}
	byConn := map[uuid.UUID][]dbgen.Model{}
	for _, m := range enabled(models) {
		byConn[m.ConnectionID] = append(byConn[m.ConnectionID], m)
	}
	var out []Target
	for _, conn := range conns {
		if !conn.Enabled {
			continue
		}
		id, ms := conn.ID, byConn[conn.ID]
		out = append(out, Target{
			Key: KindConnection + ":" + id.String(),
			Probe: func(ctx context.Context) ([]Result, error) {
				test, err := c.Probe(ctx, id)
				return ConnectionResults(id, test, err, ms)
			},
		})
	}
	return out, nil
}

// ConnectionResults turns a connection test into the connection's result
// followed by one derived result per model (DeriveModel).
func ConnectionResults(id uuid.UUID, test catalog.ConnectionTest, testErr error, models []dbgen.Model) ([]Result, error) {
	conn, err := ConnectionResult(id, test, testErr)
	if err != nil {
		return nil, err
	}
	out := []Result{conn}
	for _, m := range models {
		out = append(out, DeriveModel(m, test, conn))
	}
	return out, nil
}

// ConnectionResult turns a connection test into a result. A test that
// could not run because of the connection's own settings (an API key the
// current ENCRYPTION_KEY can't decrypt: a 409) is a failure of class
// ClassConfig with its message; any other error (the connection was
// deleted, the caller may not test, the run was cancelled, the database
// failed) proves nothing about the connection and is returned.
func ConnectionResult(id uuid.UUID, t catalog.ConnectionTest, err error) (Result, error) {
	r := Result{Kind: KindConnection, SubjectID: id, Latency: t.Latency}
	if err != nil {
		e, ok := apperr.As(err)
		if !ok || e.Status != http.StatusConflict {
			return Result{}, err
		}
		r.ErrorClass, r.Message = ClassConfig, e.Message
		return r, nil
	}
	r.OK = t.OK
	if t.Error != nil {
		r.OK, r.ErrorClass, r.HTTPStatus, r.Message = false, t.Error.Kind, t.Error.Status, t.Error.Message
	}
	return r, nil
}

// DeriveModel is a model's health from its connection's test: failing with
// the connection's error class when the connection failed; failing
// (not_found) when the connection listed its models, the list isn't empty
// and it lacks the model; otherwise healthy. SystemOne models are never in
// a model list, and an empty list proves nothing, so neither counts against
// a model.
func DeriveModel(m dbgen.Model, t catalog.ConnectionTest, conn Result) Result {
	r := Result{Kind: KindModel, SubjectID: m.ID, Latency: conn.Latency, OK: true}
	switch {
	case !conn.OK:
		r.OK, r.ErrorClass, r.HTTPStatus = false, conn.ErrorClass, conn.HTTPStatus
		r.Message = "Its connection failed its test: " + conn.Message
	case t.Probe == catalog.ProbeModels && m.Kind != catalog.KindSystemOne && len(t.Models) > 0 && !slices.Contains(t.Models, m.UpstreamModel):
		r.OK, r.ErrorClass = false, gateway.KindNotFound
		r.Message = fmt.Sprintf("The connection's model list doesn't include %s.", m.UpstreamModel)
	}
	return r
}
