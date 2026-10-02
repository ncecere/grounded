# Phase 4: publishing

Status: spec, 2026-09-26. Builds on DESIGN.md §4, §7, §8, §11, §12 and ADRs 0006, 0009, 0010, 0012, 0018, 0019.

**Exit criterion:** a public agent is embedded on a test page through the widget and answers anonymous visitors, with moderation, rate limits and daily caps enforced. An `authenticated` agent is listed in the directory and usable by any signed-in user outside its team. Admins see platform analytics and users get notifications (in-app and email).

## 1. Scope

In:
- **Audiences** `all_authenticated` ("Authenticated" in the UI) and `public`, with ADR-0006 ceilings.
- **Moderation** per ADR-0019: provider kinds, policies, input and output checks in the chat pipeline, admin UI.
- **Directory and URLs:** a directory for signed-in users, admin-assigned short names, and `/a/{short}`, `/a/{team}/{agent}` and `/a/id/{uuid}` pages usable without the app shell.
- **Anonymous public chat:** anonymous sessions, short retention, no history across sessions.
- **Embeddable widget:** a loader script and an iframe chat page, per-agent publishable keys and allowed origins, and optional CAPTCHA.
- **Public guardrails:** per-IP and per-session rate limits, per-agent daily query and token caps, concurrency, a global public switch, and the existing kill switch.
- **Notifications:** in-app (bell and inbox) and email over SMTP, with per-user settings.
- **Analytics dashboards:** a platform overview for admins and auditors; audience and moderation breakdowns in team analytics.

Out:
- break-glass, the retention and legal-hold purge jobs (only anonymous-conversation expiry is in scope), and webhooks (Phase 5 / later)
- audiences finer than these, such as groups or affiliation (later)

## 2. Decisions taken for this phase

1. **Output moderation for streamed answers depends on the audience** (owner delegated, 2026-09-26). `public`: **buffer**, so the answer is generated, checked, then sent; the UI shows the answer's steps, then "Writing and checking the answer…" until then (v0.3.0). `all_authenticated` and `team`: **stream, then retract**, so text streams live, the final text is checked, and a failing answer is replaced by a notice (SSE `moderation` event) and stored as withheld. The platform policy sets the mode per audience, and an agent may only make it stricter (stream → buffer). **Since v0.4.0** a third mode, **stream checked paragraphs** (`stream_checked`), is the default for `public`: the answer is released paragraph by paragraph, each checked with everything before it ([`moderation-streaming.md`](moderation-streaming.md)); a public policy saved before keeps its mode.
2. **Moderation is required for `public`** and fails closed: provider error or timeout (after one retry) means the answer is refused with "The safety check is unavailable right now. Please try again." (code `moderation_unavailable`; docs/ui-review F-01). For the other audiences, moderation is optional per platform policy (default off), with fail-open or fail-closed configurable.
3. **Development moderation provider:** `chat_classifier` on the gateway's `gpt-oss-20b`, until a guardrail or System One model is available. The fake proxy gets deterministic implementations of all four provider kinds for tests.
4. **CAPTCHA** is a pluggable verifier with `none` (the default) and Cloudflare Turnstile. Other providers can be added behind the same interface.
5. **The widget uses an iframe only.** The widget page is served by Grounded and calls Grounded on its own origin, so no CORS is needed. The publishable key identifies the agent and its allowed origins, enforced with `Content-Security-Policy: frame-ancestors` and an origin check on session creation.

## 3. Audiences and access

- **Grants.** Publishing sets the one grant: `team`, `all_authenticated` or `public`.
  - Editors may publish to `team`. Team admins and owners may publish to any audience.
  - Rules 5 and 6 of ADR-0006 apply: the audience must be allowed by `max_audience` of the version's effective classification.
  - `public` also requires a moderation policy with a working provider, and the platform's public switch on.
  - Changing the audience is a draft setting, published with the next version, so audiences are versioned. Because of that, an audience change doesn't need a separate endpoint.
- **Who may chat:**

  | Audience | Who |
  |---|---|
  | `team` | members (as now) |
  | `all_authenticated` | any signed-in user |
  | `public` | anyone; signed-in users chat as themselves (their conversations persist), anonymous visitors get an anonymous session |

  API keys: team keys may chat with their own team's agents (as now). Publishable keys may only start widget sessions (§6).
- **Directory** (`GET /v1/agents`) shows:
  - the caller's team agents
  - every live `all_authenticated` agent
  - every live `public` agent, when the public switch is on

  It supports search and a filter by team. The UI groups them as "Your teams", "Across the organisation" and "Public".
- **Short names.** Platform admins assign a unique short name (`^[a-z0-9][a-z0-9-]{1,39}$`, with a reserved list: `admin`, `api`, `id`, `embed`, `widget`, `auth`, `v1`, …). It resolves `/a/{short}`. Changes are audited.
- **Access log** (Sensitive and above) already exists and also covers authenticated users from other teams.

## 4. Moderation (ADR-0019)

- **Catalog.** Moderation "models" are catalog models of kind `moderation`, with a new field `moderationProvider`:
  - `moderations_endpoint`: OpenAI-style `/moderations`.
  - `guardrail_chat`, with a `family`: `llama_guard` | `granite_guardian` | `shieldgemma`.
  - `chat_classifier`: any chat model upstream; our prompt returns JSON.
  - `system_one`: TypeSafe-style `POST {base}/v1/systemone`, using its own connection's base URL and key. The model is e.g. `jev-latest`.
- **Test.** "Test model" runs one benign and one harmful fixed sample and shows the scores.
- **Categories:** `violence`, `self_harm`, `sexual`, `sexual_minors`, `harassment_hate`, `illicit`, `personal_data`, `prompt_injection`. Every provider maps into these; unmapped categories are reported as unsupported.
- **Normalised result:** `{category → probability 0–1, supported bool}`, plus provider, latency, and `calibrated` (true for System One, and for logprob-based guardrails when the server returns logprobs).
- **Policy.** One platform policy per audience (`team`, `all_authenticated`, `public`):
  - the provider (model ID)
  - per category, for input and for output: threshold (0–1) and action (`block` | `flag` | `off`)
  - the output mode (`stream_retract` | `stream_checked` | `buffer`), and `fail_closed`
  - a custom notice text
  - Defaults: `public` blocks every category at 0.5 on input and output, streams checked paragraphs (v0.4.0; buffered before), and fails closed. The others default to off.
  - Agents may make the policy stricter but not weaker (a lower threshold, block instead of flag, checked paragraphs or buffer instead of stream).
- **Pipeline:**
  - **Input** is checked before retrieval. If blocked, no retrieval and no model call happen: the reply is the notice and a `moderation` SSE event is sent.
  - **Output** is checked on the final text. Buffer mode sends the text only after it passes. Stream mode retracts: a `moderation` event is sent and the message is replaced by the notice. Checked-paragraph mode checks the answer so far at every paragraph end and releases the paragraph once it passes; a failing paragraph replaces the whole answer ([`moderation-streaming.md`](moderation-streaming.md)).
  - Flagged-but-allowed content is recorded.
  - `message_events` gets `moderation_input` and `moderation_output` (JSON: decision, top category, score, provider), with no content (ADR-0010). The audit log records policy changes.
- **Performance:** calls are bounded by the connection timeout and a moderation timeout (default 10 s). Input moderation runs concurrently with the query rewrite and, in always mode, the search; a blocked question's search results are discarded before judging or the model.

## 5. Anonymous public chat

- **Chat page.** `/a/{…}` for a public agent works without signing in. It renders a minimal, branded chat page outside the app shell (instance name, agent header, conversation), with a "Sign in" link.
- **Anonymous session:**
  - Created by `POST /v1/public/sessions {agentId, captchaToken?}`. The session is a random ID, stored hashed with its agent, IP /24 (or /48) prefix, user-agent hash and expiry, and set as an HttpOnly, Secure, SameSite=None cookie for the widget iframe (Lax for the page). Each channel has its own cookie (`grounded_anon_<agent>` for the public page, `grounded_widget_<agent>` for a session started with a publishable key), and the embed page sends `Grounded-Channel: widget` and asks for the session started with its own key (`GET /v1/public/sessions/current?key=`): the widget never continues the public page's session, even on the same site, so the key's limits, switch and allowed origins always apply (fixed in v0.4.0; before, a widget on the same site as Grounded reused the public page's keyless session).
  - Sessions expire after 24 h idle by default (`ANON_SESSION_TTL`).
  - One conversation per session at a time; "New chat" starts a new one within the session.
  - There is no history list across sessions.
- **Retention.** Anonymous conversations are deleted after `anonymous_retention` from the classification level (default 24 h) by a periodic River job. It skips anything under legal hold, and legal holds arrive in Phase 5, so this is only a hook for now. It's the first retention job and is designed to be reused by Phase 5.
- **Public chat API:** `POST /v1/public/agents/{agentId}/chat` (SSE, same events plus `moderation`) and `GET /v1/public/sessions/current` (the current conversation's messages). No other API is available anonymously.
- **Analytics:** `pseudonymous_user` is a per-agent HMAC of the session; channel is `public` or `widget`.

## 6. Widget

- **Publishable keys** (per agent; team admins):
  - `pk_<id>_<secret>`, but not secret in practice: it's embedded in pages.
  - Fields: name, allowed origins (exact `https://host[:port]`, with an optional `*.example.edu` wildcard), rate-limit overrides within the platform ceilings, enabled flag.
  - Stored hashed (ADR-0012 style). Listed, revoked and audited.
- **Loader:** `GET /widget.js` (cached; SRI hash shown in the UI).
  - Usage: `<script src="https://rag.example.edu/widget.js" data-agent="{uuid}" data-key="pk_…" data-position="bottom-right" async></script>`.
  - It injects a launcher button (accent colour, accessible name "Chat with {agent}") that opens an iframe panel to `/embed/{agentId}?key=pk_…`.
  - Keyboard: Esc closes, and focus returns to the launcher.
  - No global CSS leaks. It stays under about 6 kB gzipped, written in plain TypeScript and built separately by Vite (library mode).
- **Embed page** `/embed/{agentId}`:
  - It checks the key, agent status, audience `public` and the public switch.
  - It sets `Content-Security-Policy: frame-ancestors {allowed origins}`. `X-Frame-Options` is omitted here but kept `DENY` elsewhere.
  - It verifies the `Origin` or `Referer` on session creation against the allowed origins.
  - It renders the minimal chat. CAPTCHA runs on session creation when configured.
- **Test page for the exit criterion:** `cmd/widgetdemo` (or `make widget-demo`) serves `http://127.0.0.1:8095/` with a sample page embedding the widget. Its origin is added to the key's allowed origins in the dev setup.

## 7. Public guardrails

- **Limits** (added to the limits registry, at agent level for public and widget traffic):
  - `public_queries_per_ip_per_minute` (default 10)
  - `public_queries_per_session_per_minute` (default 6)
  - `public_queries_per_agent_per_day` (default 5,000)
  - `public_tokens_per_agent_per_day` (default 2,000,000)
  - `public_concurrent_chats_per_agent` (default 20)
  - `public_message_max_chars` (default 2,000)
- Per-minute counters are in Valkey and **fail closed** when Valkey is down, for anonymous traffic only. Daily caps come from the usage ledger.
- 429 responses carry `Retry-After`, and the UI shows a friendly message.
- **Global switch:** a platform setting `public_agents_enabled`, default off on a new install and audited. When it is off, public pages, the embed and public APIs return 503 `public_disabled` and the directory hides public agents.
- **Kill switch:** as in Phase 3; it also disables embeds.

## 8. Notifications

- **In-app.** A bell in the top bar shows the unread count, a popover lists the latest items, and an inbox page at `/notifications` has filters.
  - API: `GET /v1/notifications?unread&cursor`, `PATCH /v1/notifications/{id}` (read/unread), `POST /v1/notifications/read-all`.
  - The UI polls every 60 s and refetches on focus.
- **Email** over SMTP:
  - Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`(`_FILE`), `SMTP_FROM`, `SMTP_TLS` (`starttls` | `tls` | `none`). Email is off when `SMTP_HOST` is empty.
  - Sent by a River job with retries.
  - Plain-text plus simple HTML templates with the instance name, a link, and an unsubscribe-to-settings link.
  - Dev: Mailpit in docker compose (profile `mail`, UI on :8025).
- **Events and defaults:**

  | Event | Who | Default | Can turn off |
  |---|---|---|---|
  | Invited to a team | invitee (email; in-app once signed in) | on | no |
  | Invite about to expire (3 days) | invitee | on | yes |
  | Added to a team / role changed | member | on | yes |
  | Domain request decided | requester | on | yes |
  | Web source sync failed | source's team editors+ | on | yes |
  | Source classification lowered | team owners | on | **no** |
  | Documents need attention (v0.2: a platform admin's **Notify owners** on Admin → Parsing & OCR, `source.documents_attention`) | team owners | on | **no** |
  | Agent disabled by platform | team admins/owners | on | **no** |
  | Agent published to authenticated/public | team owners | on | yes |
  | Daily limit reached (team) | team admins/owners | on | yes |

- **Settings:** `GET/PUT /v1/me/notification-settings` (per event: in-app, email).

## 9. Analytics dashboards

- **Platform overview** at `/admin/analytics` (admins and auditors): a date range, then:
  - totals: answers, conversations, unique users, public share, refusal and no-context rates, satisfaction, moderation blocks by category
  - latency p50/p95
  - tokens by model
  - top agents and top teams by answers
  - daily chart
  - A CSV export of the daily table.
  - No content, and no user identities (ADR-0010).
- **Team analytics** (per agent) gains audience and channel breakdowns, and moderation blocked/flagged counts by category.
- **Implementation notes:**
  - API: `GET /v1/admin/analytics?from&to` and `GET /v1/admin/analytics/daily.csv?from&to` (UTC days, inclusive, default the last 30 days, at most 366). Draft test chats are left out of everything except token usage, which comes from the usage ledger (chat and embedding, including ingestion).
  - Unique users are distinct pseudonymous IDs. Those are per team (per agent for anonymous sessions), so someone using two teams' agents counts twice. The IDs are counted and never returned.
  - Moderation totals count answers: questions blocked (input), answers withheld (output blocked) and answers flagged at either stage; the category table counts decisions by stage and top category, with provider errors apart.
  - Performance: no rollup tables. Migration 00017 adds time indexes on `message_events`, `conversations` and `usage_events`, and the overview runs its queries concurrently: about 80 ms for a year of 200k events.

## 10. UI

- **Agent editor, Configure:**
  - an "Audience" section with the three options, each showing whether it's allowed and why not (classification, moderation, public switch)
  - a per-agent moderation override (stricter only)
- **Agent editor, new "Share" tab:** links (team URL, short name if any, stable ID URL), publishable keys (create, allowed origins, revoke), the embed snippet with copy, and a live preview.
- **Admin:**
  - Moderation page: providers (from models), per-audience policy editor with category thresholds and actions, and a test box.
  - Public access settings: global switch, public limits, CAPTCHA config status.
  - Short names on the admin Agents page.
  - Analytics page.
- **Everyone:** bell and inbox, notification settings in the user menu, a directory page with the three groups.
- **Public pages:** a minimal chat page and the embed page. Accessible, with no app shell, instance branding, and dark-mode aware.
- **Standards:** UI components come from bitop-ui, with any new ones added there first. Pill tabs. axe 0 violations. Screenshots of every new page.

## 11. Tests

- **Unit:**
  - each moderation provider adapter against fake proxy fixtures, including the Llama Guard "unsafe\nS1,S10" parse, Granite yes/no, ShieldGemma probabilities, classifier JSON validation, and System One `noul` answers
  - policy evaluation (stricter-only merge)
  - short-name rules
  - publishable-key parsing
  - origin matching
  - notification templating
- **Integration:**
  - publish to each audience, with ceiling and moderation-required errors
  - directory contents for different users
  - authenticated chat by a non-member
  - anonymous session, chat, retention expiry
  - input block and output retract/buffer with the fake provider
  - fail-closed for public on provider error
  - rate limits per IP and session, daily caps, global switch, kill switch on embed
  - frame-ancestors header and origin check
  - notifications created for each event, email sent through a fake SMTP server, settings honoured
  - platform analytics with no content
- **Browser** (agent-browser, screenshots in `/tmp/phase4-shots/`): the widget on the demo page (open, chat, citations, Esc), anonymous public page, directory, share tab, admin moderation and public settings, analytics, bell and inbox, and Mailpit showing an email. axe on each.
- **Live** (a real AI gateway):
  - a public agent over the registrar KB with `chat_classifier` moderation on `gpt-oss-20b`
  - chat through the widget as an anonymous visitor
  - a harmful input blocked, and an off-topic question refused
  - latency recorded with moderation on

## 12. Results

**Status: complete (2026-09-26).** The exit criterion is met on the dev instance, against a real university AI gateway. Screenshots are in `/tmp/phase4-shots/exit/`, and each area's own shots are in the sibling folders.

| Check | Result |
|---|---|
| A public agent embedded through the widget on another origin (`cmd/widgetdemo`, `http://localhost:8095`) | The launcher opens the iframe panel. An anonymous visitor asked "How do I order an official transcript?"; "Thinking…" showed while the answer was buffered for moderation, and the cited answer (Transcripts page) arrived in about 8 s. |
| Moderation on the public audience | The gateway's `gpt-oss-20b` `chat_classifier`, fail-closed, buffer mode. A request for help hurting someone was blocked on input with the policy notice, and no answering-model call was made. |
| Widget behaviour | Esc closes the panel and focus returns to the launcher. The widget script is 1.8 kB gzipped. |
| Embedding rules | A session requested from a site that isn't allowed gets `origin_not_allowed`. The embed page sends `frame-ancestors 'self'` plus the key's allowed origins. |
| Guardrails | Per-session limit: messages 1–6 were accepted and messages 7–8 got `429 rate_limited`. |
| Public page without sign-in | `/a/registrar` (admin-assigned short name) renders the minimal chat. axe: 0 violations. |
| Authenticated audience | "Records helper" was published to `all_authenticated`. Casey, not a team member, sees it in the directory and got a cited answer. |
| Analytics and notifications | Admin Analytics shows audience, channel and moderation breakdowns. Invite, domain decision and classification emails arrive in Mailpit (see `notifications/`). |

**Dev-setup lesson:** on plain HTTP the widget's demo page and Grounded must share a host (`localhost` and `localhost`), and Grounded must be reached at its `APP_URL`. Otherwise the CSRF origin check (correctly) refuses, and the anonymous-session cookie can't be sent across sites. Production uses HTTPS, where the cookie is `SameSite=None; Partitioned`.

**Deviations** are listed in each area's commit messages. The main ones:
- The moderation migration was renumbered to 00015 (notifications merged first).
- The embed origin check uses the embedding page's origin, reported by the embed page, plus the Referer on the embed page request, because the iframe's own requests come from Grounded's origin. CSP `frame-ancestors` is the enforcing control.
- The analytics migration re-creates the channel constraint idempotently.
