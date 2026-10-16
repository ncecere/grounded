package app

import (
	"context"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

// wireWebhooks builds the webhooks service (v0.6.0, F3) and hands it to what makes events. The address guard has no development allowance:
// webhooks go to the public internet, on 443, to approved hosts.
func wireWebhooks(s *Services, box *secrets.Box, jobsClient *jobs.Client) {
	s.Webhooks = webhooks.New(s.pool, jobsClient, box, webhooks.NewClient(webhooks.ClientConfig{}), s.log)
	s.Webhooks.Team = func(ctx context.Context, a authz.Actor, ref string) (dbgen.Team, string, error) {
		acc, err := s.Teams.Get(ctx, a, ref)
		return acc.Team, acc.Role, err
	}
	s.Webhooks.OnPaused = s.webhookPaused
	s.Teams.Webhooks, s.TeamRequests.Webhooks, s.Agents.Webhooks, s.Web.Webhooks = s.Webhooks, s.Webhooks, s.Webhooks, s.Webhooks
}

// webhookPaused tells the people who manage a webhook that it stopped sending: a team's admins and owners, or the platform admins.
func (s *Services) webhookPaused(ctx context.Context, tx pgx.Tx, w webhooks.Webhook, reason string) error {
	host := w.URL
	if u, err := url.Parse(w.URL); err == nil && u.Hostname() != "" {
		host = strings.ToLower(u.Hostname())
	}
	q := dbgen.New(tx)
	if w.TeamID != uuid.Nil {
		t, err := q.GetTeamByID(ctx, w.TeamID)
		if err != nil {
			return err
		}
		return s.Notify.Emit(ctx, tx, notify.WebhookPausedEvent(notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, w.ID, host, reason))
	}
	admins, err := q.ActivePlatformAdminIDs(ctx)
	if err != nil {
		return err
	}
	return s.Notify.Emit(ctx, tx, notify.PlatformWebhookPausedEvent(admins, w.ID, host, reason))
}
