// Connection tests (admin "Test connection" and `grounded doctor`). An
// OpenAI-compatible gateway is asked for its model list (GET /models). A
// SystemOne service (ADR-0020) serves only POST /v1/systemone, so a
// connection whose models are all SystemOne models is tested with one tiny
// SystemOne question instead, and so is any connection with a SystemOne
// model whose GET /models answers 404.

package catalog

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// How a connection was tested (ConnectionTest.Probe).
const (
	ProbeModels    = "models"    // GET /models
	ProbeSystemOne = "systemone" // one SystemOne question
)

// ProbeError is a proxy failure reported to admins in a test result.
type ProbeError struct {
	Kind, Message string
	Status        int
}

func probeError(err error) (*ProbeError, error) {
	var ge *gateway.Error
	if errors.As(err, &ge) {
		return &ProbeError{Kind: ge.Kind, Status: ge.Status, Message: ge.Message}, nil
	}
	return nil, err
}

// ConnectionTest is the result of testing a connection.
type ConnectionTest struct {
	OK      bool
	Latency time.Duration
	// Probe is ProbeModels or ProbeSystemOne.
	Probe string
	// Models are the model IDs GET /models listed (ProbeModels).
	Models []string
	// SystemOneModel is the upstream model the SystemOne question asked
	// (ProbeSystemOne).
	SystemOneModel string
	Error          *ProbeError
}

// TestConnection checks that the proxy is reachable and the key works, and
// lists the model IDs it advertises. Nothing is added to the catalog.
func (s *Service) TestConnection(ctx context.Context, a authz.Actor, id uuid.UUID) (ConnectionTest, error) {
	if !a.IsPlatformAdmin() {
		return ConnectionTest{}, errAdminOnly
	}
	return s.ProbeConnection(ctx, id)
}

// ProbeConnection is TestConnection without the permission check, for the
// operator's `grounded doctor`.
func (s *Service) ProbeConnection(ctx context.Context, id uuid.UUID) (ConnectionTest, error) {
	c, err := s.q.GetConnection(ctx, id)
	if err != nil {
		return ConnectionTest{}, notFound(err, errNoConn)
	}
	cl, err := s.client(c)
	if err != nil {
		return ConnectionTest{}, err
	}
	model, only, err := s.systemOneModel(ctx, id)
	if err != nil {
		return ConnectionTest{}, err
	}
	if only {
		return probeSystemOne(ctx, cl, model)
	}
	start := time.Now()
	ids, err := cl.ListModels(ctx)
	res := ConnectionTest{Probe: ProbeModels, Latency: time.Since(start), Models: ids}
	var ge *gateway.Error
	if model != "" && errors.As(err, &ge) && ge.Kind == gateway.KindNotFound {
		// No model list, but a SystemOne model: a SystemOne service.
		return probeSystemOne(ctx, cl, model)
	}
	if err != nil {
		res.Error, err = probeError(err)
		return res, err
	}
	res.OK = true
	return res, nil
}

// systemOneModel returns the upstream model of a SystemOne model on the
// connection ("" when there is none; an enabled one first) and whether
// every model on it is a SystemOne model.
func (s *Service) systemOneModel(ctx context.Context, conn uuid.UUID) (string, bool, error) {
	models, err := s.q.ListModels(ctx, dbgen.ListModelsParams{ConnectionID: uuid.NullUUID{UUID: conn, Valid: true}})
	if err != nil {
		return "", false, err
	}
	model, enabled, only := "", false, true
	for _, m := range models {
		if m.Kind != KindSystemOne {
			only = false
		} else if model == "" || (m.Enabled && !enabled) {
			model, enabled = m.UpstreamModel, m.Enabled
		}
	}
	return model, only && model != "", nil
}

// SystemOnePath is the SystemOne endpoint relative to a connection's base
// URL: a base ending in the version (https://judge.example.edu/v1) gets
// /systemone, any other base /v1/systemone.
func SystemOnePath(base string) string {
	if strings.HasSuffix(strings.TrimRight(base, "/"), "/v1") {
		return "/systemone"
	}
	return "/v1/systemone"
}

// Probe question: the smallest valid SystemOne request, one yes/no question.
const (
	probeState    = "Grounded connection test."
	probeQuestion = "Is this text a test message?"
)

type probeAnswer struct {
	Answers map[string]struct {
		Type string   `json:"type"`
		Noul *float64 `json:"noul"`
	} `json:"answers"`
}

// probeSystemOne asks one yes/no question and checks the answer's shape.
func probeSystemOne(ctx context.Context, cl *gateway.Client, model string) (ConnectionTest, error) {
	body := map[string]any{
		"state": probeState, "model": model,
		"questions": map[string]any{"q": map[string]string{"type": "noul", "instructions": probeQuestion}},
	}
	var out probeAnswer
	start := time.Now()
	err := cl.PostJSON(ctx, SystemOnePath(cl.BaseURL), body, &out)
	res := ConnectionTest{Probe: ProbeSystemOne, SystemOneModel: model, Latency: time.Since(start), Models: []string{}}
	if a, ok := out.Answers["q"]; err == nil && (!ok || a.Type != "noul" || a.Noul == nil) {
		err = &gateway.Error{Kind: gateway.KindBadResponse, Message: "SystemOne: the answer to the test question is missing or not a yes/no answer"}
	}
	if err != nil {
		res.Error, err = probeError(err)
		return res, err
	}
	res.OK = true
	return res, nil
}
