// Command fakemcp runs a fake remote MCP server for local development and
// smoke tests of MCP tools in agents (docs/mcp-client.md):
//
//	go run ./cmd/fakemcp                        # http://127.0.0.1:8091/mcp
//	go run ./cmd/fakemcp -header X-API-Key -value dev-key
//
// It serves Streamable HTTP statelessly with the tools of
// testutil.FakeMCP: check_outage {service}, slow, huge, needs_input (an MRTR
// input request) and broken (a tool error). Register it with DEV_AUTH on a
// loopback APP_URL, which allows http and loopback addresses.
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/testutil"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8091", "listen address")
	header := flag.String("header", "", "require this request header (for example Authorization)")
	value := flag.String("value", "", "the header's value")
	flag.Parse()
	f, h := testutil.NewFakeMCPHandler()
	if *header != "" {
		f.RequireHeader(*header, *value)
	}
	mux := http.NewServeMux()
	mux.Handle("/mcp", h)
	log.Printf("fake MCP server on http://%s/mcp", *addr)
	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
