package contextual

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/user"
	"path/filepath"
	"testing"
)

func TestAcceptanceReviewLedgerUsesOSPrincipalHome(t *testing.T) {
	account, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(account.HomeDir, ".local", "state", "grounded-issue21")
	if acceptanceStateRoot != want {
		t.Fatalf("canonical ledger is not rooted in the executing OS principal's home")
	}
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	if acceptanceCanonicalStateRoot() != want {
		t.Fatal("environment changes reset the canonical approval ledger")
	}
}

func TestAcceptanceReviewReportClaimedBeforeDispatch(t *testing.T) {
	if os.Getenv("GROUNDED_TEST_DATABASE_URL") == "" {
		t.Skip("requires disposable PG")
	}
	proxy, config := fakeAcceptanceConfig(t)
	g := acceptanceTestGrant(t)
	g.Config = config
	if err := acceptanceWritePrivate(g.KeyFile, []byte(proxy.APIKey)); err != nil {
		t.Fatal(err)
	}
	grant := filepath.Join(filepath.Dir(g.KeyFile), "grant.json")
	data, _ := json.Marshal(g)
	if err := acceptanceWritePrivate(grant, data); err != nil {
		t.Fatal(err)
	}
	checks := 0
	reportClaimed := false
	source := func(ctx context.Context) (string, error) {
		checks++
		if checks > 1 {
			info, err := os.Lstat(g.ReportFile)
			if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
				return "", errors.New("report_not_claimed_before_dispatch")
			}
			reportClaimed = true
		}
		return acceptanceTestSource(ctx)
	}
	err := executeAcceptanceEntry(t, grant, acceptanceEntryDeps{root: filepath.Join(t.TempDir(), "state"), source: source, testLoopback: true})
	if err != nil || !reportClaimed {
		t.Fatalf("dispatch without an exclusively claimed report: claimed=%v err=%v", reportClaimed, err)
	}
	raw, err := acceptanceReadPrivate(g.ReportFile, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		GrantID string `json:"grantID"`
	}
	if json.Unmarshal(raw, &report) != nil || report.GrantID != g.ID {
		t.Fatal("report cannot be tied to its permanent grant claim")
	}
}
