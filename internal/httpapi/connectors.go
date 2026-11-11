package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/sourcesync"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Connector sources (ADR-0035, #258; docs/source-types.md): a team's editors change a connector source's settings and
// credentials, test its connection, start and cancel its syncs, and decide the removals a sync held. Team sources only:
// a shared source is an upload or a web source.
func (a *api) connectorRoutes() []route {
	return []route{
		{"POST", "/v1/teams/{team}/source-types/{key}/check", a.session(a.checkSourceTypeConnection)},
		{"PUT", "/v1/teams/{team}/sources/{sourceId}/connector", a.session(a.putSourceConnector)},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/connector/check", a.session(a.checkSourceConnection)},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/syncs", a.either(a.listSourceSyncs)},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/syncs", a.either(a.startSourceSync)},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/syncs/{syncId}/cancel", a.session(a.cancelSourceSync)},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/syncs/{syncId}/removals", a.session(a.getSyncRemovals)},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/syncs/{syncId}/removals", a.session(a.decideSyncRemovals)},
	}
}

// connectorSettings converts a request's connector settings (nil: none sent).
func connectorSettings(in *apitypes.ConnectorSettingsInput) *sourcesync.Settings {
	if in == nil {
		return nil
	}
	out := &sourcesync.Settings{}
	if in.Config != nil {
		out.Config, _ = json.Marshal(*in.Config)
	}
	if in.Credentials != nil {
		out.Credentials = *in.Credentials
	}
	if in.Schedule != nil {
		out.Schedule = string(*in.Schedule)
	}
	return out
}

func toAPISourceSync(s dbgen.SourceSync) apitypes.SourceSync {
	out := apitypes.SourceSync{
		Id: s.ID, SourceId: s.SourceID, Status: apitypes.SourceSyncStatus(s.Status), Trigger: apitypes.SourceSyncTrigger(s.Trigger),
		Full: s.FullListing, Complete: s.Complete, ItemsAdded: s.ItemsAdded, ItemsChanged: s.ItemsChanged,
		ItemsUnchanged: s.ItemsUnchanged, ItemsSkipped: s.ItemsSkipped, ItemsRemoved: s.ItemsRemoved,
		PermissionsChanged: s.PermissionsChanged, Removals: apitypes.SourceSyncRemovals(s.Removals),
		RemovalsPending: s.RemovalsPending, RemovalsReason: s.RemovalsReason, StoppedReason: s.StoppedReason, Error: s.Error,
		Problems: []apitypes.SourceSyncProblem{}, CreatedAt: s.CreatedAt, StartedAt: s.StartedAt, FinishedAt: s.FinishedAt,
	}
	_ = json.Unmarshal(s.Problems, &out.Problems)
	return out
}

// addConnector fills the connector side of a source's API form.
func addConnector(out *apitypes.DataSource, s sources.Summary) {
	if s.Connector == nil {
		return
	}
	c := apitypes.SourceConnector{
		Schedule: apitypes.SyncSchedule(s.Connector.Schedule), Config: map[string]any{}, CredentialKeys: nonNilStrings(s.Connector.CredentialKeys),
		CredentialsSetAt: s.Connector.CredentialsSetAt, LastCompleteAt: s.Connector.LastCompleteAt, Available: s.Connector.Available,
	}
	_ = json.Unmarshal(s.Source.Config, &c.Config)
	out.Connector = &c
	if s.ActiveSync != nil {
		run := toAPISourceSync(*s.ActiveSync)
		out.ActiveSync = &run
	}
	if s.Connector.Held != nil {
		run := toAPISourceSync(*s.Connector.Held)
		out.HeldSync = &run
	}
}

func toAPIConnectionCheck(c connector.CheckResult) apitypes.ConnectionCheck {
	out := apitypes.ConnectionCheck{Summary: c.Summary}
	out.Reachable = make([]struct {
		Id   string `json:"id"`
		Kind string `json:"kind"`
		Name string `json:"name"`
	}, len(c.Reachable))
	for i, r := range c.Reachable {
		out.Reachable[i].Id, out.Reachable[i].Kind, out.Reachable[i].Name = r.ID, r.Kind, r.Name
	}
	return out
}

// optionalSettings reads connector settings from a body that may be empty.
func optionalSettings(w http.ResponseWriter, r *http.Request) (*sourcesync.Settings, bool) {
	if r.ContentLength == 0 {
		return nil, true
	}
	var in apitypes.ConnectorSettingsInput
	if !httpx.Decode(w, r, &in) {
		return nil, false
	}
	return connectorSettings(&in), true
}

func (a *api) checkSourceTypeConnection(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ConnectorSettingsInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	res, err := a.Sources.CheckNewConnection(r.Context(), a.actor(r), teamOwner(r), r.PathValue("key"), *connectorSettings(&in))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIConnectionCheck(res))
}

func (a *api) checkSourceConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	try, ok := optionalSettings(w, r)
	if !ok {
		return
	}
	res, err := a.Sources.CheckConnection(r.Context(), a.actor(r), teamOwner(r), id, try)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIConnectionCheck(res))
}

func (a *api) putSourceConnector(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.ConnectorSettingsInput](w, r)
	if !ok {
		return
	}
	s, err := a.Sources.SetConnector(r.Context(), a.actor(r), teamOwner(r), id, *connectorSettings(&in), rev)
	if failed(w, r, err) {
		return
	}
	setETag(w, s.Source.Revision)
	httpx.JSON(w, http.StatusOK, a.withOCRState(r, toAPISource(s), s.Source))
}

func (a *api) listSourceSyncs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	list, err := a.Sources.Syncs(r.Context(), a.actor(r), teamOwner(r), id, limit)
	writeList(w, r, list, err, toAPISourceSync)
}

func (a *api) startSourceSync(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	var in apitypes.SourceSyncStart
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	run, err := a.Sources.StartSync(r.Context(), a.actor(r), teamOwner(r), id, in.Full != nil && *in.Full)
	var busy *sourcesync.InProgressError
	if errors.As(err, &busy) {
		e, _ := apperr.As(err)
		httpx.ErrorDetails(w, e.Status, e.Code, e.Message, map[string]any{"sync": toAPISourceSync(busy.Sync)})
		return
	}
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusAccepted, toAPISourceSync(run))
}

func (a *api) cancelSourceSync(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	syncID, ok := pathUUID(w, r, "syncId")
	if !ok {
		return
	}
	run, err := a.Sources.CancelSync(r.Context(), a.actor(r), teamOwner(r), id, syncID)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPISourceSync(run))
}

func (a *api) getSyncRemovals(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	syncID, ok := pathUUID(w, r, "syncId")
	if !ok {
		return
	}
	run, docs, err := a.Sources.HeldRemovals(r.Context(), a.actor(r), teamOwner(r), id, syncID)
	if failed(w, r, err) {
		return
	}
	out := apitypes.SyncRemovals{Sync: toAPISourceSync(run)}
	out.Documents = make([]struct {
		Filename string    `json:"filename"`
		Id       uuid.UUID `json:"id"`
		Title    string    `json:"title"`
		Url      string    `json:"url"`
	}, len(docs))
	for i, d := range docs {
		out.Documents[i].Id, out.Documents[i].Title, out.Documents[i].Filename, out.Documents[i].Url = d.ID, d.Title, d.Filename, d.URL
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) decideSyncRemovals(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	syncID, ok := pathUUID(w, r, "syncId")
	if !ok {
		return
	}
	var in apitypes.SyncRemovalsDecision
	if !httpx.Decode(w, r, &in) {
		return
	}
	run, err := a.Sources.DecideRemovals(r.Context(), a.actor(r), teamOwner(r), id, syncID, in.Confirm)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPISourceSync(run))
}
