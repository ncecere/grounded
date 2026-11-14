package testutil

import (
	"testing"

	"github.com/ncecere/grounded/internal/fakes"
)

// The fake servers live in internal/fakes, which does not import testing;
// these start one for a test and close it when the test ends.

// NewFakeProxy starts a fake model gateway for one test.
func NewFakeProxy(t testing.TB) *fakes.FakeProxy {
	t.Helper()
	p := fakes.StartFakeProxy()
	t.Cleanup(p.Close)
	return p
}

// NewFakeSystemOneService starts a fake that serves only POST /v1/systemone,
// like a SystemOne service (ADR-0020).
func NewFakeSystemOneService(t testing.TB) *fakes.FakeProxy {
	t.Helper()
	p := fakes.StartFakeSystemOneService()
	t.Cleanup(p.Close)
	return p
}

// NewFakeMCP starts a fake remote MCP server for one test.
func NewFakeMCP(t testing.TB) *fakes.FakeMCP {
	t.Helper()
	f := fakes.StartFakeMCP()
	t.Cleanup(f.Close)
	return f
}
