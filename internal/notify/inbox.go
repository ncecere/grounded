// The in-app inbox and per-user settings.

package notify

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Item is one in-app notification.
type Item = dbgen.ListNotificationsRow

// Cursor pages the inbox (newest first).
type Cursor struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

// ListParams filter the inbox.
type ListParams struct {
	UnreadOnly bool
	Type       Type // "" = every type
	After      *Cursor
	Limit      int32
}

var errUnknownType = apperr.Invalid("invalid_type", "Unknown notification type")

// List returns a page of a user's notifications and the cursor of the next
// page (nil at the end).
func (s *Service) List(ctx context.Context, userID uuid.UUID, p ListParams) ([]Item, *Cursor, error) {
	arg := dbgen.ListNotificationsParams{UserID: nullUUID(userID), UnreadOnly: p.UnreadOnly, PageSize: p.Limit + 1}
	if p.Type != "" {
		if _, ok := Lookup(p.Type); !ok {
			return nil, nil, errUnknownType
		}
		t := string(p.Type)
		arg.Type = &t
	}
	if p.After != nil {
		arg.AfterCreated, arg.AfterID = &p.After.CreatedAt, nullUUID(p.After.ID)
	}
	rows, err := s.q.ListNotifications(ctx, arg)
	if err != nil || len(rows) <= int(p.Limit) {
		return rows, nil, err
	}
	rows = rows[:p.Limit]
	last := rows[len(rows)-1]
	return rows, &Cursor{CreatedAt: last.CreatedAt, ID: last.ID}, nil
}

// UnreadCount is the number of unread notifications for the bell.
func (s *Service) UnreadCount(ctx context.Context, userID uuid.UUID) (int64, error) {
	return s.q.CountUnreadNotifications(ctx, nullUUID(userID))
}

var errNoNotification = apperr.NotFound("notification_not_found", "Notification not found")

// SetRead marks one of the user's notifications read or unread.
func (s *Service) SetRead(ctx context.Context, userID, id uuid.UUID, read bool) (Item, error) {
	n, err := s.q.SetNotificationRead(ctx, dbgen.SetNotificationReadParams{Read: read, ID: id, UserID: nullUUID(userID)})
	if err != nil {
		return Item{}, err
	}
	if n == 0 {
		return Item{}, errNoNotification
	}
	row, err := s.q.GetNotification(ctx, dbgen.GetNotificationParams{ID: id, UserID: nullUUID(userID)})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Item{}, errNoNotification
	}
	return Item(row), err
}

// MarkAllRead marks every unread notification (of one type, when set) read
// and returns how many changed.
func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID, t Type) (int64, error) {
	var typ *string
	if t != "" {
		if _, ok := Lookup(t); !ok {
			return 0, errUnknownType
		}
		v := string(t)
		typ = &v
	}
	return s.q.MarkAllNotificationsRead(ctx, dbgen.MarkAllNotificationsReadParams{UserID: nullUUID(userID), Type: typ})
}

// ClaimForEmail gives a user the items addressed to their email before they
// had signed in (invites). Call it in the sign-in transaction, only for a
// verified address.
func ClaimForEmail(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, email string) error {
	_, err := q.ClaimNotificationsForEmail(ctx, dbgen.ClaimNotificationsForEmailParams{UserID: nullUUID(userID), Email: email})
	return err
}

// Setting is one event type with a user's effective channels.
type Setting struct {
	Def
	Channels
}

// Settings returns the user's effective setting for every event type.
func (s *Service) Settings(ctx context.Context, userID uuid.UUID) ([]Setting, error) {
	rows, err := s.q.ListNotificationSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	saved := map[Type]Channels{}
	for _, r := range rows {
		saved[Type(r.Type)] = Channels{InApp: r.InApp, Email: r.Email}
	}
	out := make([]Setting, 0, len(catalog))
	for _, d := range catalog {
		var ch *Channels
		if c, ok := saved[d.Type]; ok {
			ch = &c
		}
		out = append(out, Setting{Def: d, Channels: Resolve(d, ch)})
	}
	return out, nil
}

// SettingInput changes one event type.
type SettingInput struct {
	Type Type
	Channels
}

// UpdateSettings saves the given event types (others are unchanged).
// Turning a mandatory event off is refused.
func (s *Service) UpdateSettings(ctx context.Context, userID uuid.UUID, in []SettingInput) ([]Setting, error) {
	for _, x := range in {
		d, ok := Lookup(x.Type)
		if !ok {
			return nil, errUnknownType
		}
		if d.Mandatory && (!x.InApp || !x.Email) {
			return nil, apperr.Invalid("notification_mandatory", `"`+d.Label+`" notifications are required and can't be turned off`)
		}
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		for _, x := range in {
			if err := q.UpsertNotificationSetting(ctx, dbgen.UpsertNotificationSettingParams{
				UserID: userID, Type: string(x.Type), InApp: x.InApp, Email: x.Email,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Settings(ctx, userID)
}
