package httpapi_test

import "testing"

func TestAuthorizationMatrixSignedExports(t *testing.T) {
	e := newMatrixEnv(t)
	calls := 0
	for _, op := range []string{"adminGetAuditExportSettings", "adminPutAuditExportSettings", "adminListAuditExports", "adminRequestAuditExport", "adminGetAuditExport", "adminRetryAuditExport", "adminDownloadAuditExport"} {
		p := matrixPolicies[op]
		for _, rn := range runsFor(p.scope) {
			for c := caller(0); c < numCallers; c++ {
				if rn.callers.has(c) && e.check(t, op, p, rn, c) {
					calls++
				}
			}
		}
	}
	t.Logf("signed export authorization: %d calls", calls)
}
