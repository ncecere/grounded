package demo

import (
	"context"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// A persona that signs in between the owner look-up and the insert (the
// upgrade test signs in while the demo seeds) is used, not refused; an
// account with the persona's subject but another email still is.
func TestProvisionPersonaSignedInMeanwhile(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	s := &seeder{pool: pool, q: dbgen.New(pool)}
	insert := func(subject, email string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, claims) VALUES ($1, $2, $3, 'X', '{}')`,
			auth.DevIssuer, subject, email); err != nil {
			t.Fatal(err)
		}
	}

	insert("admin", "Admin@localhost")
	u, err := s.provisionPersona(ctx, "admin", "admin@localhost", "Dev Platform Admin")
	if err != nil || u.OIDCSubject != "admin" {
		t.Fatalf("signed in meanwhile: user %q, err %v", u.OIDCSubject, err)
	}
	if len(s.res.Created) != 0 {
		t.Errorf("created %v for an account that already existed", s.res.Created)
	}
	var audits int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE action = 'demo.owner_provision'").Scan(&audits); err != nil || audits != 0 {
		t.Errorf("audit rows = %d (%v), want 0", audits, err)
	}

	insert("user", "someone-else@localhost")
	if _, err := s.provisionPersona(ctx, "user", "user@localhost", "Dev User"); err == nil || !strings.Contains(err.Error(), "another email") {
		t.Errorf("another email: err = %v", err)
	}
}
