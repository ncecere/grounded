package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/limits"
)

func period(d limits.Def) apitypes.LimitPeriod {
	if d.Period == limits.PeriodNone {
		return apitypes.LimitPeriod("none")
	}
	return apitypes.LimitPeriod(d.Period)
}

func toAPIPlatformLimits(svc *limits.Service, p limits.Platform) apitypes.PlatformLimits {
	out := apitypes.PlatformLimits{Revision: p.Revision, UpdatedAt: p.UpdatedAt, Items: []apitypes.PlatformLimit{}}
	for _, d := range limits.Defs() {
		st := p.Settings[d.Key]
		out.Items = append(out.Items, apitypes.PlatformLimit{
			Key: apitypes.LimitKey(d.Key), Group: apitypes.LimitGroup(d.Group), Unit: apitypes.LimitUnit(d.Unit), Period: period(d),
			Label: d.Label, Description: d.Description, Default: st.Default, Ceiling: st.Ceiling,
			BuiltInDefault: svc.BuiltIn(d.Key), Custom: p.Custom[d.Key], Max: d.Max,
		})
	}
	return out
}

func toAPITeamOverrides(c limits.TeamConfig) apitypes.TeamLimitOverrides {
	out := apitypes.TeamLimitOverrides{TeamId: c.Team.ID, Revision: c.Revision, Items: []apitypes.TeamLimitOverride{}}
	for _, d := range limits.Defs() {
		st := c.Platform.Settings[d.Key]
		item := apitypes.TeamLimitOverride{
			Key: apitypes.LimitKey(d.Key), Group: apitypes.LimitGroup(d.Group), Unit: apitypes.LimitUnit(d.Unit), Period: period(d),
			Label: d.Label, Description: d.Description, Default: st.Default, Ceiling: st.Ceiling,
			Effective: c.Platform.Effective(d.Key, c.Overrides), Max: d.Max,
		}
		if v, ok := c.Overrides[d.Key]; ok {
			item.Override = &v
		}
		out.Items = append(out.Items, item)
	}
	return out
}

func (a *api) adminGetLimits(w http.ResponseWriter, r *http.Request) {
	p, err := a.Limits.Platform(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, p.Revision, toAPIPlatformLimits(a.Limits, p))
}

func (a *api) adminUpdateLimits(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.PlatformLimitsUpdate](w, r)
	if !ok {
		return
	}
	changes := make([]limits.SettingChange, len(in.Items))
	for i, it := range in.Items {
		changes[i] = limits.SettingChange{Key: limits.Key(it.Key), Setting: limits.Setting{Default: it.Default, Ceiling: it.Ceiling}}
	}
	p, err := a.Limits.UpdatePlatform(r.Context(), a.actor(r), changes, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, p.Revision, toAPIPlatformLimits(a.Limits, p))
}

func (a *api) adminGetTeamLimits(w http.ResponseWriter, r *http.Request) {
	c, err := a.Limits.TeamOverrides(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPITeamOverrides(c))
}

func (a *api) adminUpdateTeamLimits(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.TeamLimitOverridesUpdate](w, r)
	if !ok {
		return
	}
	changes := make([]limits.OverrideChange, len(in.Items))
	for i, it := range in.Items {
		changes[i] = limits.OverrideChange{Key: limits.Key(it.Key), Value: it.Value}
	}
	c, err := a.Limits.UpdateTeamOverrides(r.Context(), a.actor(r), r.PathValue("team"), changes, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPITeamOverrides(c))
}

func (a *api) getTeamLimits(w http.ResponseWriter, r *http.Request) {
	u, err := a.Limits.TeamUsage(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	out := apitypes.TeamLimits{Items: []apitypes.TeamLimit{}}
	for _, it := range u.Items {
		d := it.Def
		out.Items = append(out.Items, apitypes.TeamLimit{
			Key: apitypes.LimitKey(d.Key), Group: apitypes.LimitGroup(d.Group), Unit: apitypes.LimitUnit(d.Unit), Period: period(d),
			Label: d.Label, Description: d.Description, Max: it.Max, Used: it.Used, Overridden: it.Overridden,
		})
	}
	httpx.JSON(w, http.StatusOK, out)
}
