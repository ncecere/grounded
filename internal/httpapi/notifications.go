// Notification handlers: the caller's inbox and settings
// (docs/phase4-publishing.md §8). Browser sessions only; notifications are
// personal, so API keys never see them.

package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/notify"
)

// notificationRoutes: the inbox and the caller's notification settings.
func (a *api) notificationRoutes() []route {
	return []route{
		{"GET", "/v1/notifications", a.session(a.listNotifications)},
		{"PATCH", "/v1/notifications/{notificationId}", a.session(a.updateNotification)},
		{"POST", "/v1/notifications/read-all", a.session(a.markAllNotificationsRead)},
		{"GET", "/v1/me/notification-settings", a.session(a.getNotificationSettings)},
		{"PUT", "/v1/me/notification-settings", a.session(a.updateNotificationSettings)},
	}
}

func sessionUser(r *http.Request) uuid.UUID {
	id, _ := auth.FromContext(r.Context())
	return id.User.ID
}

func toAPINotification(n notify.Item) apitypes.Notification {
	out := apitypes.Notification{
		Id: n.ID, Type: apitypes.NotificationType(n.Type), Title: n.Title, Body: n.Body, Link: n.Link,
		Read: n.ReadAt != nil, ReadAt: n.ReadAt, CreatedAt: n.CreatedAt,
	}
	if n.TeamID.Valid {
		out.TeamId = &n.TeamID.UUID
	}
	return out
}

func (a *api) listNotifications(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	p := notify.ListParams{Limit: limit, Type: notify.Type(r.URL.Query().Get("type"))}
	if raw := r.URL.Query().Get("unread"); raw != "" {
		b, err := strconv.ParseBool(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_unread", "unread must be true or false")
			return
		}
		p.UnreadOnly = b
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	if keys != nil {
		t, err1 := time.Parse(time.RFC3339Nano, keys[0])
		id, err2 := uuid.Parse(keys[1])
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		p.After = &notify.Cursor{CreatedAt: t, ID: id}
	}
	user := sessionUser(r)
	rows, next, err := a.Notify.List(r.Context(), user, p)
	if failed(w, r, err) {
		return
	}
	unread, err := a.Notify.UnreadCount(r.Context(), user)
	if failed(w, r, err) {
		return
	}
	out := apitypes.NotificationPage{Items: make([]apitypes.Notification, len(rows)), UnreadCount: unread}
	for i, n := range rows {
		out.Items[i] = toAPINotification(n)
	}
	if next != nil {
		out.NextCursor = encodeCursor(next.CreatedAt.Format(time.RFC3339Nano), next.ID.String())
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) updateNotification(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "notificationId")
	if !ok {
		return
	}
	var in apitypes.NotificationUpdate
	if !httpx.Decode(w, r, &in) {
		return
	}
	n, err := a.Notify.SetRead(r.Context(), sessionUser(r), id, in.Read)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPINotification(n))
}

func (a *api) markAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	var in apitypes.NotificationReadAll
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	var t notify.Type
	if in.Type != nil {
		t = notify.Type(*in.Type)
	}
	n, err := a.Notify.MarkAllRead(r.Context(), sessionUser(r), t)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.NotificationReadAllResult{Updated: n})
}

func (a *api) writeNotificationSettings(w http.ResponseWriter, r *http.Request, items []notify.Setting, err error) {
	if failed(w, r, err) {
		return
	}
	out := apitypes.NotificationSettings{EmailEnabled: a.Notify.Email, Items: make([]apitypes.NotificationSetting, 0, len(items))}
	admin := a.actor(r).IsPlatformAdmin()
	// A team event is listed for people with its role in some team: a member doesn't see owners' events (v0.4.2 US-14).
	teams, err := a.Teams.ListMine(r.Context(), sessionUser(r))
	if failed(w, r, err) {
		return
	}
	reaches := func(role string) bool {
		for _, t := range teams {
			if authz.RoleAtLeast(t.MemberRole, role) {
				return true
			}
		}
		return false
	}
	for _, s := range items {
		if s.PlatformAdmins && !admin {
			continue // events only platform admins receive
		}
		if s.TeamRole != "" && !reaches(s.TeamRole) {
			continue
		}
		out.Items = append(out.Items, apitypes.NotificationSetting{
			Type: apitypes.NotificationType(s.Type), Label: s.Label, Description: s.Description,
			Mandatory: s.Mandatory, InApp: s.InApp, Email: s.Email,
		})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) getNotificationSettings(w http.ResponseWriter, r *http.Request) {
	items, err := a.Notify.Settings(r.Context(), sessionUser(r))
	a.writeNotificationSettings(w, r, items, err)
}

func (a *api) updateNotificationSettings(w http.ResponseWriter, r *http.Request) {
	var in apitypes.NotificationSettingsUpdate
	if !httpx.Decode(w, r, &in) {
		return
	}
	if len(in.Items) > 50 {
		httpx.Error(w, http.StatusBadRequest, "invalid_settings", "At most 50 settings at a time")
		return
	}
	changes := make([]notify.SettingInput, len(in.Items))
	for i, x := range in.Items {
		changes[i] = notify.SettingInput{Type: notify.Type(x.Type), Channels: notify.Channels{InApp: x.InApp, Email: x.Email}}
	}
	items, err := a.Notify.UpdateSettings(r.Context(), sessionUser(r), changes)
	a.writeNotificationSettings(w, r, items, err)
}
