# Threat model

STRIDE (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege) for each trust boundary of [`data-flow.md`](data-flow.md). Each threat names its mitigation (details and tests in [`controls.md`](controls.md)) and what remains. Open findings and accepted risks are at the end.

**Assets,** most sensitive first: team content (documents, passages) up to Restricted; conversation transcripts; stored secrets (gateway, SMTP and moderation credentials) and the two install keys (`ENCRYPTION_KEY`, `API_KEY_PEPPER`); API and publishable keys; the audit log; identities and OIDC claims; availability of chat for public agents.

**Attackers:** an anonymous internet user; a signed-in user with no team; a member of one team going after another; a holder of a leaked or narrowly scoped API key; the author of a page Grounded crawls or a document someone uploads (prompt injection); a site embedding or imitating the widget; a curious or compromised platform admin; a compromised dependency or build.

**Trusted, outside Grounded's control:** the OIDC provider, the model gateway (it sees what is sent to it), the database, object storage and Valkey services, the ingress and TLS, and the Kubernetes cluster.

## 1. Tenant isolation (users and API clients → api)

| | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Acting as a member of another team | Server-side sessions tied to `(issuer, sub)`; team role looked up on every request, in the transaction that acts | — |
| T | Changing another team's sources, KBs, agents, keys or members | Every write checks the team role in the service; the authorization matrix calls every write as every caller against another team's objects and checks nothing changed | New routes are only as safe as their classification: the matrix fails until they're classified |
| R | Denying a change | Audit log with actor, key ID, request ID and IP, append-only in the database | A database superuser can still rewrite it (see accepted risks) |
| I | Reading another team's content or learning its objects exist; transcripts read by team admins | Non-members get 404; responses to cross-team calls are checked for the other team's names, IDs and content; transcripts are their user's alone; analytics are aggregates | — |
| D | One team exhausting shared capacity | Per-team limits and quotas, per-key and per-user rate limits (DESIGN §11) | Model gateway capacity is shared; see §8 |
| E | A member acting as editor, an editor as admin; a scoped key doing more than its scope | Role and scope checks per operation; the matrix's own-team cells check each role and each key scope | — |

**Found and fixed in this review:** a personal API key could list, read, rename, delete, export and rate *all* of its user's conversations, including those with other teams' agents, whatever its scope or agent restriction (`agents/conversations.go`). Keys are now limited to their team's agents, within their restriction, with the `query` scope (`TestPersonalKeyConversationsStayWithinTheKey`).

## 2. SSRF (worker → crawled websites)

| | Threat | Mitigation | Residual |
|---|---|---|---|
| S | A site redirecting or resolving to an internal service to impersonate it | Every hop checked; addresses resolved and pinned at dial time (no DNS rebinding) | — |
| T | Crawled content changing stored data | Content is parsed as data; only text and metadata are stored | See §3 for content that talks to the model |
| I | Reading cloud metadata, the database, Valkey or cluster services through the crawler | Only public unicast addresses (RFC 1918, loopback, link-local and 169.254.169.254, CGNAT, the Azure wire server, multicast, documentation ranges refused; IPv6 limited to global unicast); schemes and ports restricted; the crawl allowlist (platform admins) and domain requests | `AllowPrivateAddressesForTests` exists for tests only (not a setting) |
| D | Crawls that never end or fill storage | Page, depth, size and time limits; per-origin pacing; per-team crawl limits; maintenance mode | — |
| E | A team crawling sites outside the allowlist | Allowlist enforced for every hop; domain requests need a platform admin | — |

Model connections are different: platform admins point them at any URL, including private addresses (gateways usually run inside the institution), and the connection test reports errors and timings. That is an admin power (§7), not a path for teams.

## 3. Prompt injection through retrieved content (documents → model → user)

A document or crawled page can contain text written to steer the model ("ignore your instructions…").

| | Threat | Mitigation | Residual |
|---|---|---|---|
| T | The answer contains the attacker's text or false claims | Passages are wrapped in `<sources>`, closing tags inside them escaped, with a system instruction to treat them as data; citations are checked against the retrieved passages; optional SystemOne citation and scope checks; answers show their sources | Models don't always obey; a poisoned source can still mislead users. Who may add content to a KB is the team's control (editors) |
| I | The model reveals other data | The model sees only what the agent retrieved for this question from the agent's own KBs, within the classification ceilings, and the user's own turns; it has no tool other than knowledge search; it makes no outbound requests | A passage from the same KB can be surfaced out of context |
| I | Exfiltration through the rendered answer (a markdown image or link carrying data to another site) | Raw HTML is never rendered; images from other origins don't load without a click (`response.tsx`), and the CSP limits `img-src` to `'self' data:` (plus the logo origin); `javascript:` URLs are stripped | A user can still be tricked into clicking a link |
| E | The model taking actions | None available: no write tools, no browsing, no code execution | — |

## 4. Public agents, the widget and origins (anonymous visitors and third-party pages → api)

| | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Another site embedding the widget with a stolen publishable key | Allowed origins checked at session start and enforced by the embed page's CSP `frame-ancestors`; the key reaches one agent | A non-browser client can send any `Origin`; publishable keys are public by design, so rate limits and caps are what bound abuse |
| T | Clickjacking or CSRF against the app | `X-Frame-Options: DENY` and `frame-ancestors 'none'` except the embed page; CSRF token and `Origin` on every session write; the anonymous API accepts writes only from Grounded's own origin and refuses credentials | — |
| I | Visitors reading each other's anonymous conversations; public agents answering from content above their classification | Anonymous sessions are random tokens stored hashed, per agent; audience ceilings per classification level; team-only agents are 404 on the public API | — |
| D | Floods of anonymous chat burning the model budget | Per-IP and per-agent rate limits, daily caps that fail closed without Valkey, optional CAPTCHA, message length limits, the public-access switch and per-agent kill switches | Distributed floods below the per-IP limit are bounded only by the daily caps |
| E | Harmful output on a public page | Moderation of input and output (buffered answers for public agents), fail-closed option | Classifier quality |

## 5. API keys and the pepper

| | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Guessing or reusing a key | 40-character random secret; only HMAC-SHA256(`API_KEY_PEPPER`, key) stored; expiry; per-key rate limits; revoked when the user leaves the team | — |
| I | A database dump revealing usable keys | Digests need the pepper, which isn't in the database | Pepper and dump leaked together: rotate the pepper (`rotate-keys` runbook) |
| E | A key administering the platform or another team | Keys never carry a platform role; bound to one team; scopes and restrictions checked (matrix key columns) | — |
| R | Actions by a key | Audit entries carry the key ID | Service keys act for the team, not a person: their responsible contact is recorded |

## 6. OIDC (browser ↔ OIDC provider ↔ api)

| | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Forged or replayed ID tokens; login CSRF; code interception | `go-oidc` verification (issuer, audience, signature, expiry), nonce, state, PKCE; `(issuer, sub)` identifies users, not email | The provider is trusted: whoever it authenticates signs in. Restrict with allowed email domains or a provider-side access policy; the startup checks warn when no domain restriction is set |
| E | Becoming the first platform admin | Bootstrap by exact `(issuer, sub)`, once | — |
| I | Open redirects after sign-in | `next` limited to local paths | — |
| D | Password spraying through the login flow | Sign-in attempts rate-limited per IP; credentials are the provider's concern | — |

## 7. Admin powers and break-glass

| | Threat | Mitigation | Residual |
|---|---|---|---|
| I | A platform admin reading team content or transcripts | No content access by default; break-glass only: one team, a scope, a time box, a reason shown to owners, every read audited before content is fetched, owners notified at start and end (can't be turned off), optional second-admin approval; `TestAuthorizationMatrixBreakGlass` checks exactly the scope's reads open and nothing else | An admin can change model connections, and so point chats at a gateway they control and see what is sent to it (audited, visible to other admins). Operators who need to prevent this separate duties outside Grounded |
| T | Admins changing team content | Not possible even under break-glass (no writes) | Admins can disable agents, change limits and archive teams: audited |
| R | Covering tracks | Audit log append-only in the database; break-glass reads recorded by kind and target | A database owner can bypass triggers |
| E | An auditor changing anything | Auditors read only; every admin write checks `platform_admin` in the service; the matrix checks each | — |

## 8. Supply chain and the platform

| | Threat | Mitigation | Residual |
|---|---|---|---|
| T | A compromised dependency or build step | `govulncheck` on every push; images built only in CI with SBOM, provenance and a cosign signature, scanned by Trivy (fixable HIGH and CRITICAL fail the build), deployed by digest; actions pinned by SHA; `npm ci --ignore-scripts` | Malicious code in a pinned dependency version isn't caught by vulnerability scanners |
| T | A tampered image | Verify the cosign signature against the workflow identity before deploying (command in the image job summary) | Operators must actually verify |
| I | Secrets in the image or repository | No secrets baked in; Trivy secret scan clean (see `dependencies.md`); secrets come from Kubernetes Secrets | — |
| D | Model gateway outage | Chat and retrieval degrade to `model_unavailable`; everything else keeps working | Availability is bounded by the gateway's |
| E | Container escape | Distroless, non-root, read-only root filesystem, no capabilities, seccomp `RuntimeDefault`; PDF parsing in WebAssembly (wazero) | — |

## Findings and accepted risks

| ID | Finding | Status |
|---|---|---|
| M5-1 | Personal API keys reached every transcript of their user regardless of team, scope and agent restriction (and could rename and delete them) | **Fixed** (this milestone), with a regression test; found by the authorization matrix |
| M5-2 | The GitHub Actions of CI's `test` job were referenced by mutable tags | **Fixed**: pinned by SHA |
| M5-3 | `/metrics` is served on the API listener, which the generic `Ingress` routes (`path: /`), so request counts by route and status are public. No user, team or content labels | **Fixed.** `METRICS_ADDR` serves `/metrics` on an internal listener (`:9091` in the Kubernetes base); the api listener behind the Ingress answers 404 for it (`TestMetricsMoveToTheirOwnListener`, and the kind smoke test checks it) |
| M5-4 | Admin write routes decode the body before the service checks `platform_admin`, so an auditor sending a malformed body gets `400` instead of `403`. No data is revealed | Accepted |
| M5-5 | The distroless base image is referenced by tag, not digest; a rebuild picks up base updates (the current scan finds only a pending `tzdata` update) | Accepted: rebuilt on every push to `main`; pin by digest if reproducible builds matter more than prompt base updates |
| AR-1 | Platform admins can direct model traffic (and so content in chats) to a gateway they choose | Accepted: admin trust, audited |
| AR-2 | Database superusers can alter the audit log | Accepted: protect database credentials; ship audit data to external logging if required |
| AR-3 | Prompt injection can still mislead answers | Mitigated, not solvable in general; content governance is the team's |
