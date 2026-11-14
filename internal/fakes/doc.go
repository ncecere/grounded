// Package fakes holds the deterministic fake servers Grounded is developed
// and tested against: an OpenAI-compatible model gateway (FakeProxy) and a
// remote MCP server (FakeMCP). It does not import testing, so the
// development binaries (cmd/fakeproxy, cmd/fakemcp, tools/e2eserver) link it
// without the test framework; tests start them through internal/testutil,
// which closes them with the test (#253).
package fakes
