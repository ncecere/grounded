Grounded reads its settings from environment variables, optionally layered over a flat YAML file named by `GROUNDED_CONFIG_FILE` (environment variables win). Secrets can also be read from files: set `KEY_FILE` to a path instead of `KEY`, for example `SMTP_PASSWORD_FILE=/run/secrets/smtp-password`. This works for every secret below.

On Kubernetes, non-secret settings go in the `grounded-config` ConfigMap and secrets in `grounded-runtime` (see [Install on Kubernetes](/docs/self-hosting/kubernetes#3-set-the-configuration)). The environment variables in this list are meant to stay stable through 0.x; if one has to change, the release notes say how to adapt.

Defaults shown are the binary's own. The Kubernetes base sets a few differently; they're noted.

## Server

| Variable | Default | Meaning |
|---|---|---|
| `APP_URL` | (required) | The public origin people reach Grounded at. Must be `https://` unless it's a loopback address. The OIDC redirect URI is `<APP_URL>/auth/callback`. |
| `HTTP_ADDR` | `:8080` | The API and web app listener. |
| `WORKER_HTTP_ADDR` | `:9090` | The worker's listener (health and metrics only). |
| `METRICS_ADDR` | (empty) | Serve the API's `/metrics` (and health checks) on this internal listener instead of `HTTP_ADDR`, so a public ingress never exposes it. The base sets `:9091`. |
| `LOG_FORMAT` | `json` | `json` or `text`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MIGRATE_ON_START` | `false` | Run migrations when the server starts. The Kubernetes base keeps it off and runs them in an init container. |
| `SHUTDOWN_DELAY` | `5s` | How long a stopping pod keeps answering while failing readiness, so load balancers notice. The base sets `10s`. |
| `SHUTDOWN_TIMEOUT` | `60s` | Time in-flight requests (including streamed chats) and jobs get to finish. The base sets `90s`; keep the pod's grace period above both. |
| `TRUSTED_PROXIES` | (empty) | CIDRs of the ingress controller, allowed to set `X-Forwarded-For`. Needed for correct client IPs, per-address rate limits and logs. |
| `SESSION_TTL` | `12h` | Browser session lifetime (5 minutes to 30 days). |
| `REQUESTS_PER_MINUTE` | `600` | A general request limit per signed-in user. |
| `LOGIN_ATTEMPTS_PER_MINUTE` | `20` | Sign-in attempts per client address. |
| `WORKER_CONCURRENCY` | `10` | Background jobs run at once per worker process (the default queue). |
| `GROUNDED_CONFIG_FILE` | (empty) | A YAML file of settings, read first. |

## Data stores

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required, secret) | PostgreSQL connection URL. `pool_max_conns` in it sets the pool size. |
| `VALKEY_URL` | (required, secret) | Valkey or Redis URL, `redis://` or `rediss://`. |
| `VALKEY_PREFIX` | `grounded:` | Prefix for every key, if the Valkey instance is shared. |
| `BLOB_BACKEND` | `fs` | `s3` for any real install (the base sets it); `fs` stores files on local disk, for development. |
| `BLOB_DIR` | `data/blobs` | Directory for the `fs` backend. |
| `S3_ENDPOINT` | (empty) | S3-compatible endpoint. For AWS, the regional endpoint. |
| `S3_BUCKET` | (empty) | Bucket name. |
| `S3_REGION` | `us-east-1` | Region. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | (secret) | Credentials. On Kubernetes they come from the `grounded-s3` secret. |
| `S3_PREFIX` | (empty) | Key prefix inside the bucket. |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style addressing, which most S3-compatible services need. |
| `S3_CA_FILE` | (empty) | A CA bundle for an endpoint with a private certificate. |

## Secrets and keys

| Variable | Meaning |
|---|---|
| `ENCRYPTION_KEY` | Encrypts secrets stored in the database (gateway, MCP server, SMTP and moderation credentials). 32 random bytes, base64: `openssl rand -base64 32`. Back it up. |
| `ENCRYPTION_KEY_PREVIOUS` | The old key during a rotation, still accepted for reads. |
| `API_KEY_PEPPER` | Keys the HMAC of stored API keys, widget keys and MCP OAuth tokens. Generate it like `ENCRYPTION_KEY`. Changing it without keeping the old value invalidates all keys. |
| `API_KEY_PEPPER_PREVIOUS` | The old pepper during a rotation; keys on it are re-hashed when next used. |

Grounded refuses to start off loopback with the example values from `.env.example`. See [Rotating keys](/docs/self-hosting/security#rotating-keys).

## Sign-in

| Variable | Default | Meaning |
|---|---|---|
| `OIDC_ISSUER` | (empty) | Your identity provider's issuer URL. Required off loopback. |
| `OIDC_CLIENT_ID` | (empty) | The client ID. |
| `OIDC_CLIENT_SECRET` | (secret) | The client secret. |
| `OIDC_SCOPES` | `openid,profile,email` | Scopes to request. |
| `OIDC_EMAIL_CLAIM` | `email` | The claim that holds the email address. |
| `OIDC_GROUPS_CLAIM` | `groups` | The ID token claim that lists groups, for SSO group mapping. |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | `true` | Refuse sign-ins whose email isn't verified. |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | (empty) | Comma-separated domains allowed to sign in. Empty allows anyone the provider signs in (reported as information). |
| `BOOTSTRAP_ADMIN_SUBJECT` | (empty) | The OIDC subject of the first platform admin. |
| `DEV_AUTH` | `false` | Development sign-in with fixed personas. Refused unless `APP_URL` is loopback. |
| `DEV_AUTH_GROUPS` | (empty) | Development only: groups for the personas, `persona=group,group;persona=group`. |

See [OIDC and SSO](/docs/self-hosting/oidc).

## Instance identity

| Variable | Default | Meaning |
|---|---|---|
| `INSTANCE_NAME` | `Grounded` | The product name in the app and page titles. |
| `ORG_NAME` | (empty) | Your organisation's name, used in the app and the agents' preamble. |
| `UI_THEME` | `neutral` | The only theme. Brand with the settings in this table. It has light and dark values: since v0.4.2 each person chooses System, Light or Dark in their [account menu](/docs/using/personal-settings). |
| `UI_LOGO_URL` | (empty) | An https URL or same-origin path for your logo. |
| `SUPPORT_URL` | (empty) | The "Help" link: an http(s) URL or a `mailto:` address. |
| `TEAM_REQUEST_URL` | (empty) | Where people request a team, for example a service-desk form. |

Since v0.4.2 platform staff see these values, read-only and with their variables, on [Admin → Settings](/docs/administration/settings#from-the-environment).

## Ingestion and retrieval

| Variable | Default | Meaning |
|---|---|---|
| `MAX_UPLOAD_BYTES` | 100 MB | The largest upload. |
| `INGEST_CONCURRENCY` | `4` | Document jobs per worker process. |
| `INGEST_MAX_INFLIGHT` | `32` | Documents queued or processing across the platform. |
| `INGEST_MAX_INFLIGHT_PER_TEAM` | `8` | The default for the team limit "concurrent ingestion jobs". |
| `EMBED_BATCH_SIZE` | `64` | Inputs per embedding request, shared across documents. |
| `EMBED_BATCH_TOKENS` | `32768` | Counted tokens per embedding request (0 = no limit). |
| `EMBED_BATCH_WAIT` | `100ms` | How long a partial embedding request waits for more documents. |
| `PDF_WORKERS` | `2` | PDF parser instances per process (each uses tens of MB). |
| `VECTOR_EXACT_THRESHOLD` | `100000` | Knowledge bases with up to this many vectors are searched exactly. |
| `VECTOR_EF_SEARCH` | `400` | The approximate index's candidate list above the threshold. |
| `RETRIEVAL_VECTOR_WEIGHT` | `1` | Platform default hybrid fusion weight for vector search (0–1). |
| `RETRIEVAL_KEYWORD_WEIGHT` | `0.1` | Platform default weight for keyword search (0–1). |
| `PROFILE_MIGRATION_GRACE_DAYS` | `7` | Days a knowledge base keeps its old vectors after a profile migration (0–90). |
| `EVALUATION_CONCURRENCY` | `2` | Questions an evaluation run checks at once (1–8). |
| `BOILERPLATE_WEB` | `true` | Remove repeated blocks from web sources by default. |
| `BOILERPLATE_UPLOAD` | `false` | The same for upload sources. |
| `BOILERPLATE_MIN_DOCS` | `5` | A block is repeated when it's in at least this many documents… |
| `BOILERPLATE_RATIO` | `0.2` | …and this share of the source's documents (0.05–1). |

## Parsing and OCR

| Variable | Default | Meaning |
|---|---|---|
| `TIKA_URL` | (empty) | Apache Tika, used as a fallback parser and as an OCR backend with its `-full` image. |
| `TIKA_TIMEOUT` | `2m` | One Tika request. |
| `TIKA_PREFER_KINDS` | (empty) | Kinds sent to Tika before the built-in parser, for example `pdf`. |
| `OCR_TESSERACT_URL` | (empty) | The `grounded-ocr` sidecar; makes Tesseract selectable. |
| `OCR_TIMEOUT` | `2m` | One page's OCR request. |
| `OCR_MAX_PAGES_PER_DOCUMENT` | `200` | Pages read per document; the rest are skipped with a warning. |
| `OCR_CONCURRENCY` | `2` | Pages read at once per worker process. |

OCR stays off until a platform admin turns it on. See [Parsing and OCR](/docs/administration/parsing-and-ocr).

## Web crawling

| Variable | Default | Meaning |
|---|---|---|
| `CRAWL_ALLOWLIST_SEED` | (empty) | Host patterns (`*.example.org,example.com`) added to the crawl allowlist once, on the first start. Deleting them later doesn't bring them back. |
| `CRAWL_MAX_PAGES` | `10000` | The ceiling for a source's maximum pages. |
| `CRAWL_ORIGIN_INTERVAL` | `1s` | Spacing between requests to one site, across all workers (100 ms to 1 minute). |
| `CRAWL_USER_AGENT` | `grounded/1.0 (+$APP_URL/bot)` | The crawler's user agent. Grounded doesn't serve a `/bot` page, so set one with a real contact URL. |
| `CRAWL_TIMEOUT` | `30s` | Per request, including the body. |
| `CRAWL_MAX_BODY_BYTES` | 20 MiB | Larger pages are skipped. |
| `CRAWL_CONCURRENCY` | `4` | Crawl jobs per worker process. |

Private, loopback and link-local addresses, and ports other than 80 and 443, are always refused.

## Email

Email is off while `SMTP_HOST` is empty; in-app notifications always work.

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST` | (empty) | The relay. |
| `SMTP_PORT` | `587` | `587` for STARTTLS, `465` for TLS. |
| `SMTP_TLS` | `starttls` | `starttls`, `tls` or `none` (a local relay only). |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | (empty; password secret) | Credentials, if the relay needs them. |
| `SMTP_FROM` | (empty) | The sender, for example `"Grounded <grounded@example.org>"`. |

## Public agents

| Variable | Default | Meaning |
|---|---|---|
| `ANON_SESSION_TTL` | `24h` | Anonymous sessions end this long after their last use. |
| `CAPTCHA_PROVIDER` | `none` | `none` or `turnstile`. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | (empty; secret key secret) | Cloudflare Turnstile keys. |
| `MODERATION_TIMEOUT` | `10s` | Bounds each moderation check attempt (1 s to 2 minutes). Chat classifiers get at least 30 s. |

Public access itself is switched on in the admin portal.

## Retention defaults

Empty or `keep` keeps the data. A platform admin can override each one under Retention. Conversation retention is set per classification level instead. Confirm periods with your records management first.

| Variable | Range | Kind |
|---|---|---|
| `RETENTION_DELETED_CONVERSATIONS_DAYS` | 0–36500 | Grace period after a user deletes a conversation. |
| `RETENTION_ACCESS_LOG_DAYS` | 1–36500 | The access log. |
| `RETENTION_ANALYTICS_EVENTS_DAYS` | 1–36500 | Per-answer metadata events. |
| `RETENTION_USAGE_EVENTS_DAYS` | 7–36500 | The usage ledger (rolled up per day first). |
| `RETENTION_AUDIT_LOG_DAYS` | 30–36500 | The audit log (legal hold entries are always kept). |
| `RETENTION_DELETED_FILES_DAYS` | 0–36500 | Stored files of deleted documents and sources. |
| `RETENTION_EXPIRED_INVITES_DAYS` | 1–36500 | Invites after they expire or are revoked. |
| `RETENTION_EVALUATION_RUNS_DAYS` | 1–36500 or `keep` | Evaluation runs and results. Default `180`. |
| `RETENTION_BATCH_SIZE` | default `500` | Rows per transaction. |
| `RETENTION_MAX_BATCHES` | default `100` | Batches per kind per run (runs are every 10 minutes). |

## Health checks

| Variable | Default | Meaning |
|---|---|---|
| `HEALTH_CHECK_INTERVAL` | `15m` | How often the worker re-tests enabled connections, models and MCP servers, at no cost: `5m` to `24h`, or `0` / `off` to stop the scheduled check. See [Stored health](/docs/self-hosting/health). |

## Tracing

Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. See [Tracing](/docs/self-hosting/tracing).

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty: off) | The OTLP receiver's base URL, `http://` or `https://`. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | `http/protobuf` (port 4318) or `grpc` (port 4317). |
| `OTEL_EXPORTER_OTLP_HEADERS` | (empty; secret) | Headers for every export, `name=value` pairs separated by commas, values URL-encoded. Never logged. |
| `OTEL_SERVICE_NAME` | `grounded` | The `service.name` of every span. |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | `always_on`, `always_off`, `traceidratio` or their `parentbased_*` forms. |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | The share of new traces kept (0–1). The `tracing` component sets `0.2`. |

The MCP server and its OAuth sign-in have no environment variables: platform admins switch them on in the admin portal ([MCP server and OAuth](/docs/self-hosting/mcp-server)).

## The demo

`grounded demo` has its own `DEMO_*` variables, one per flag. See [Try it locally](/docs/getting-started/try-it-locally#use-real-models).
