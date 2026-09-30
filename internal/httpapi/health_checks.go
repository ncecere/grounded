package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Stored health (docs/operations/health.md): the admin Test buttons store
// their result, and GET /v1/admin/health-checks reads each subject's latest.

func (a *api) adminListHealthChecks(w http.ResponseWriter, r *http.Request) {
	checks, err := a.health.Latest(r.Context(), a.actor(r), r.URL.Query().Get("kind"))
	writeList(w, r, checks, err, toAPIHealthCheck)
}

func toAPIHealthCheck(c healthcheck.Latest) apitypes.HealthCheck {
	out := apitypes.HealthCheck{
		SubjectKind: apitypes.HealthSubjectKind(c.SubjectKind), SubjectId: c.SubjectID, SubjectName: c.SubjectName,
		SubjectEnabled: c.SubjectEnabled, Status: apitypes.HealthCheckStatus(c.Status), LatencyMs: c.LatencyMs,
		ErrorClass: (*apitypes.HealthCheckErrorClass)(c.ErrorClass), HttpStatus: c.HttpStatus, Message: c.Message,
		Trigger: apitypes.HealthCheckTrigger(c.Trigger), CheckedAt: c.CheckedAt, StatusSince: c.StatusSince,
	}
	if c.TriggeredBy.Valid {
		out.TriggeredBy = &c.TriggeredBy.UUID
		if c.TriggeredByName != "" {
			out.TriggeredByName = &c.TriggeredByName
		}
	}
	return out
}

// recordConnectionTest stores an admin's connection test and the health
// it implies for the connection's enabled models. A failure to store it is
// logged, not returned: the admin still gets the test result.
func (a *api) recordConnectionTest(r *http.Request, id uuid.UUID, test catalog.ConnectionTest, testErr error) {
	err := a.health.RecordConnectionTest(r.Context(), id, test, testErr, healthcheck.TriggerManual, a.byActor(r))
	if err != nil && err != testErr {
		a.Log.WarnContext(r.Context(), "could not store a connection test", "connection", id, "err", err)
	}
}

// writeModelTest stores an admin's model test as the model's health and
// writes it.
func (a *api) writeModelTest(w http.ResponseWriter, r *http.Request, id uuid.UUID, out apitypes.ModelTestResult) {
	res := healthcheck.Result{
		Kind: healthcheck.KindModel, SubjectID: id, OK: out.Ok, Latency: time.Duration(out.LatencyMs) * time.Millisecond,
		Trigger: healthcheck.TriggerManual, By: a.byActor(r),
	}
	if !out.Ok {
		res.ErrorClass, res.Message = "unavailable", "The test failed."
		if e := out.Error; e != nil {
			res.ErrorClass, res.Message = string(e.Kind), e.Message
			if e.Status != nil {
				res.HTTPStatus = *e.Status
			}
		}
	}
	if _, err := a.health.Record(r.Context(), res); err != nil {
		a.Log.WarnContext(r.Context(), "could not store a model test", "model", id, "err", err)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) byActor(r *http.Request) uuid.NullUUID {
	id := a.actor(r).UserID
	return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil}
}
