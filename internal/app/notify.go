package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
)

// wireNotify connects the notification service to the services whose
// changes notify people (docs/phase4-publishing.md §8).
func wireNotify(s *Services) {
	s.Teams.Notify = s.Notify
	s.Web.Notify = s.Notify
	s.Sources.Notify = s.Notify
	s.Agents.Notify = s.Notify
	s.Limits.OnDailyLimit = func(ctx context.Context, teamID uuid.UUID, key limits.Key, max int64) {
		noun := string(key)
		if d, ok := limits.Lookup(key); ok {
			noun = d.Noun
		}
		s.Notify.DailyLimitReached(ctx, teamID, string(key), noun, max)
	}
}

// NewMailSender returns the SMTP sender, or nil when email is off.
func NewMailSender(cfg config.Config) notify.Sender {
	if !cfg.SMTP.Enabled() {
		return nil
	}
	return &notify.SMTPSender{Config: notify.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password, TLS: cfg.SMTP.TLS,
	}}
}

// registerNotify adds the email worker and the invite-expiry scan.
func registerNotify(w *river.Workers, cfg config.Config, pool *pgxpool.Pool, s *Services, sender notify.Sender, log *slog.Logger) {
	river.AddWorker(w, &notify.EmailWorker{
		Pool: pool, Sender: sender, From: cfg.SMTP.From, Log: log,
		Site: notify.Site{Instance: cfg.Instance.Name, AppURL: cfg.AppURL},
	})
	river.AddWorker(w, &notify.InviteExpiryWorker{S: s.Notify})
}

// notifyPeriodic runs the invite-expiry scan daily (and on start).
func notifyPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(24*time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return notify.InviteExpiryArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}
