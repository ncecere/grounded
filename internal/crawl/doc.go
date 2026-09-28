// Package crawl is the web fetching and crawl-policy layer for `web` data
// sources (DESIGN §5.3, ADR-0008). It is ported from yoink's internal/crawl
// (http.go, url.go, scope.go, discovery.go), internal/urlpolicy and
// internal/ratelimit, without yoink's job model, rendering, budgets or DB.
// There is no JavaScript rendering.
//
// # SSRF
//
// Every request (pages, robots.txt, sitemaps, and each redirect hop) passes
// through one guarded transport that:
//   - allows only http/https, and only ports 80 and 443 (non-default ports
//     fail with ErrBlockedAddress);
//   - consults HostPolicy with the hostname (ErrHostNotAllowed);
//   - resolves the host once, as an absolute DNS name, and requires every
//     answer to be public unicast: loopback, RFC 1918, CGNAT, link-local,
//     multicast, unspecified, benchmarking, documentation, IPv6 ULA/link-local,
//     6to4/Teredo/NAT64 and IPv4-mapped forms of any of these are refused
//     (ErrBlockedAddress). Mixed public/private answers are refused;
//   - dials only the approved addresses, so a DNS rebind between check and
//     connect cannot redirect the connection;
//   - ignores proxy environment variables and requires TLS 1.2+.
//
// Normalize parses legacy IPv4 notations (decimal, octal, hex, short forms)
// exactly as browsers do, so "http://2130706433/" is identified and blocked
// as 127.0.0.1 rather than handed to a libc resolver.
// FetcherConfig.AllowPrivateForTests lifts the address and port checks for
// httptest servers; it must never be set in production.
//
// # Behaviour choices (where the API sketch left room)
//
//   - Fetch sends the normalised URL on the wire (sorted query, tracking
//     params removed), so what is fetched is exactly the identity key.
//   - Timeout bounds each HTTP exchange (connect, headers and body) and
//     excludes time spent waiting on the Pacer, so busy origins do not cause
//     spurious timeouts. A redirect chain gets a fresh Timeout per hop.
//   - Pacer origins are "scheme://host:port" with an explicit port.
//   - robots.txt (RFC 9309): product token is the UserAgent up to the first
//     '/' or space ("grounded"). 2xx is parsed (first 512 KiB); 404/410 and other
//     4xx allow everything; 401/403/429/5xx, network errors and unparseable
//     files disallow everything (yoink's conservative choice). An HTML body is
//     treated as having no rules (yoink denied; soft-404 pages are common).
//     Decisions are cached per origin for 1h; failures for 1 min; HostPolicy/
//     SSRF errors are never cached. With RespectRobots, redirect targets are
//     checked too.
//   - Non-2xx responses return a Page (Status set, no body) and no error; 2xx
//     with an unsupported type returns the Page without body plus
//     ErrUnsupportedContent. Bodies above MaxBodyBytes are truncated and
//     flagged (gzip is decoded with the same bound on compressed bytes).
//   - Scope exclusion syntax and Links' nofollow handling are documented on
//     Scope and Links.
package crawl
