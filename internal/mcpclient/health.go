package mcpclient

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Stored health (docs/operations/health.md): Test reads the server's tool
// list and stores the result; the health job re-tests each enabled server
// the same way (a list, never tools/call, so a scheduled run costs nothing).

// Test tests a server (platform admins; the server may be disabled) and
// stores the result as its health, like Test connection.
func (s *Service) Test(ctx context.Context, a authz.Actor, id uuid.UUID) (TestResult, error) {
	if !a.IsPlatformAdmin() {
		return TestResult{}, errAdminOnly
	}
	sv, err := s.server(ctx, id)
	if err != nil {
		return TestResult{}, err
	}
	res := s.probe(ctx, sv.McpServer)
	if s.Health != nil {
		r := HealthResult(id, res)
		r.Trigger, r.By = healthcheck.TriggerManual, by(a)
		if _, err := s.Health.Record(context.WithoutCancel(ctx), r); err != nil {
			s.Log.WarnContext(ctx, "could not store an MCP server test", "server", id, "err", err)
		}
	}
	return res, nil
}

// HealthResult turns a test into a stored-health result. Classes that
// stored health doesn't know are mapped to the nearest one (a timeout is
// unavailable; an oversized or input-requesting answer is bad_response).
func HealthResult(id uuid.UUID, t TestResult) healthcheck.Result {
	r := healthcheck.Result{Kind: healthcheck.KindMCPServer, SubjectID: id, OK: t.OK, Latency: t.Latency}
	if t.Err != nil {
		r.OK, r.HTTPStatus, r.Message = false, t.Err.HTTPStatus, t.Err.Message
		switch t.Err.Class {
		case ClassTimeout:
			r.ErrorClass = ClassUnavailable
		case ClassTooLarge, ClassInputRequired:
			r.ErrorClass = ClassBadResponse
		default:
			r.ErrorClass = t.Err.Class
		}
	}
	return r
}

// Checker is the health job's checker of MCP servers: one target per
// enabled server, keyed by the server.
func (s *Service) Checker() healthcheck.Checker { return checker{s} }

type checker struct{ s *Service }

func (c checker) Targets(ctx context.Context) ([]healthcheck.Target, error) {
	rows, err := c.s.q.ListMCPServers(ctx)
	if err != nil {
		return nil, err
	}
	var out []healthcheck.Target
	for _, r := range rows {
		if !r.Enabled {
			continue
		}
		sv := dbgen.McpServer{ID: r.ID, Name: r.Name, URL: r.URL, AuthHeaderName: r.AuthHeaderName, AuthValueCipher: r.AuthValueCipher,
			TimeoutSeconds: r.TimeoutSeconds, Enabled: r.Enabled}
		out = append(out, healthcheck.Target{
			Key: healthcheck.KindMCPServer + ":" + r.ID.String(),
			Probe: func(ctx context.Context) ([]healthcheck.Result, error) {
				return []healthcheck.Result{HealthResult(sv.ID, c.s.probe(ctx, sv))}, nil
			},
		})
	}
	return out, nil
}
