package preflight

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

type fakeQueries struct {
	allowlist []dbgen.CrawlAllowlist
	public    bool
	provider  *uuid.UUID // nil: no stored policy
	stored    bool
	err       error
}

func (f fakeQueries) ListAllowlist(context.Context) ([]dbgen.CrawlAllowlist, error) {
	return f.allowlist, f.err
}

func (f fakeQueries) GetPlatformSettings(context.Context) (dbgen.PlatformSetting, error) {
	return dbgen.PlatformSetting{PublicAgentsEnabled: f.public}, nil
}

func (f fakeQueries) GetModerationPolicy(_ context.Context, audience string) (dbgen.ModerationPolicy, error) {
	if audience != "public" {
		return dbgen.ModerationPolicy{}, errors.New("unexpected audience " + audience)
	}
	if !f.stored {
		return dbgen.ModerationPolicy{}, pgx.ErrNoRows
	}
	p := dbgen.ModerationPolicy{Audience: audience}
	if f.provider != nil {
		p.ModelID = uuid.NullUUID{UUID: *f.provider, Valid: true}
	}
	return p, nil
}

func codes(fs []Finding) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.Code
	}
	return out
}

func TestCheck(t *testing.T) {
	ctx := context.Background()
	configured := config.Defaults()
	configured.SMTP.Host = "smtp.example.edu"
	configured.OIDC.Issuer, configured.OIDC.AllowedEmailDomains = "https://idp.example.edu", []string{"example.edu"}
	allow := []dbgen.CrawlAllowlist{{Pattern: "*.example.edu"}}
	model := uuid.New()

	cases := []struct {
		name string
		cfg  func() config.Config
		q    fakeQueries
		want []string
	}{
		{"all good", func() config.Config { return configured }, fakeQueries{allowlist: allow, public: true, stored: true, provider: &model}, nil},
		{"empty allowlist", func() config.Config { return configured }, fakeQueries{}, []string{CodeCrawlAllowlistEmpty}},
		{"public off without moderation", func() config.Config { return configured }, fakeQueries{allowlist: allow}, nil},
		{"public on, no stored policy", func() config.Config { return configured }, fakeQueries{allowlist: allow, public: true},
			[]string{CodePublicWithoutModeration}},
		{"public on, policy without provider", func() config.Config { return configured }, fakeQueries{allowlist: allow, public: true, stored: true},
			[]string{CodePublicWithoutModeration}},
		{"no smtp", func() config.Config { c := configured; c.SMTP.Host = ""; return c }, fakeQueries{allowlist: allow}, []string{CodeSMTPNotConfigured}},
		{"oidc without domains", func() config.Config { c := configured; c.OIDC.AllowedEmailDomains = nil; return c }, fakeQueries{allowlist: allow},
			[]string{CodeOIDCNoDomainRestriction}},
		{"dev auth only: no oidc finding", func() config.Config { c := configured; c.OIDC = config.OIDC{}; return c }, fakeQueries{allowlist: allow}, nil},
		{"everything, warnings first", func() config.Config { c := configured; c.SMTP.Host, c.OIDC.AllowedEmailDomains = "", nil; return c },
			fakeQueries{public: true}, []string{CodeCrawlAllowlistEmpty, CodePublicWithoutModeration, CodeSMTPNotConfigured, CodeOIDCNoDomainRestriction}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Check(ctx, tc.cfg(), tc.q)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(codes(got), tc.want) {
				t.Fatalf("codes = %v, want %v", codes(got), tc.want)
			}
			for _, f := range got {
				if f.Message == "" || f.Fix == "" || (f.Severity != Warning && f.Severity != Info) {
					t.Errorf("incomplete finding %+v", f)
				}
			}
		})
	}
	if _, err := Check(ctx, configured, fakeQueries{err: errors.New("boom")}); err == nil {
		t.Fatal("query error swallowed")
	}
}

func TestLog(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	Log(context.Background(), log, []Finding{
		{Code: "a", Severity: Warning, Message: "warned", Fix: "fix a"},
		{Code: "b", Severity: Info, Message: "noted", Fix: "fix b"},
	})
	out := buf.String()
	if !strings.Contains(out, "level=WARN msg=\"preflight: warned\" code=a") || !strings.Contains(out, "level=INFO msg=\"preflight: noted\" code=b") {
		t.Fatalf("log = %s", out)
	}
}
