Grounded upgrades without downtime. New pods migrate the database while the previous version keeps serving, and for the length of a rollout old and new code share one database. That works because every migration is **expand/contract**: each release's schema works with the previous release's code, and destructive steps ship at least one release later. CI checks it on every release with an upgrade test.

## How to upgrade

<Steps>
<Step>

**Read the release notes** for anything to do before or after. Don't skip a release that its notes mark as required.

</Step>
<Step>

**Take a backup**, or check that last night's ran.

</Step>
<Step>

**Bump the base and the image together** in your overlay: change every `?ref=` to the new tag, and pin the new digest of `ghcr.io/ncecere/grounded` (and `ghcr.io/ncecere/grounded-ocr` if you run OCR). Verify the digest first (below).

</Step>
<Step>

**Let it roll.** Each new pod's `migrate` init container migrates under an advisory lock (concurrent runs wait; only the first does any work), then new pods start while old ones keep serving (`maxUnavailable: 0`, `maxSurge: 1`). Workers roll at the same time and share the job queue.

</Step>
<Step>

**Check** `/readyz`, the admin Overview, and `grounded doctor`.

</Step>
</Steps>

Stopping pods drain: they fail readiness, wait `SHUTDOWN_DELAY` for load balancers, then give in-flight requests (including streamed chats) and running jobs `SHUTDOWN_TIMEOUT` to finish. Jobs still running are cancelled and retried elsewhere.

**Rolling back** means pinning the previous digest: because of expand/contract, the previous release runs on the newer schema. Migrations are never rolled back. **Downgrading** across a release isn't supported; to go back further, restore a backup taken before the upgrade.

## Pinning digests

Images are published for linux/amd64 and linux/arm64. Release tags are `vX.Y.Z`, `vX.Y` and `latest-release`; release candidates get only their own tag, such as `v0.4.3-rc.1`. There's no `latest` tag. **Tags can move, so deploy by digest**:

```sh
docker buildx imagetools inspect ghcr.io/ncecere/grounded:v0.4.4   # prints the index digest
```

```yaml
images:
  - name: ghcr.io/ncecere/grounded
    newTag: v0.4.4             # informational
    digest: sha256:<digest>    # what is deployed
```

## Verifying images

Each image is built only in CI, scanned with Trivy, and signed with cosign using keyless signing tied to the repository's GitHub Actions workflows. Verify before you deploy:

```sh
cosign verify ghcr.io/ncecere/grounded@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/ncecere/grounded/\.github/workflows/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

For a stricter check, use `--certificate-identity https://github.com/ncecere/grounded/.github/workflows/image.yml@refs/tags/v0.4.4`. The same works for `grounded-ocr`. Then:

```sh
docker run --rm ghcr.io/ncecere/grounded@sha256:<digest> version
# grounded v0.4.4 (<commit>)
```

Each image carries an SPDX SBOM and SLSA provenance as attestations, covered by the signature:

```sh
IMAGE=ghcr.io/ncecere/grounded@sha256:<digest>
docker buildx imagetools inspect "$IMAGE" --format '{{ json (index .SBOM "linux/amd64").SPDX }}' > sbom.spdx.json
docker buildx imagetools inspect "$IMAGE" --format '{{ json (index .Provenance "linux/amd64").SLSA }}' > provenance.json
```

Since v0.2.0, each GitHub release also attaches the SBOMs per platform, the digest files and a `checksums.txt` (`sha256sum -c checksums.txt`).

## Release by release

| From → to | Migrations | What to do |
|---|---|---|
| v0.4.3 → [v0.4.4](/docs/releases/v0-4-4) | `00045` (schema 44 → 45), expand-only: two nullable columns on `models`. River's own schema moves to version 8 at startup (a no-op migration) | A rolling upgrade: bump `?ref=` and the digests. No new environment variables, and nothing changed in `deploy/kubernetes` or `deploy/observability`. **If you derive from the OCR image**, its base is now Debian 13: check the `apt-get install` of any extra `tesseract-ocr-*` package against Debian 13's names and re-check OCR output on a few of your own scans (Tesseract 5.5 instead of 5.3). People get a Profile page and an API keys page in the account menu, and the model **Test** now checks "How to turn thinking off". |
| v0.4.2 → [v0.4.3](/docs/releases/v0-4-3) | None (schema stays at 44) | A rolling upgrade: bump `?ref=` and the digests. A security patch (Go 1.26.9 and golang.org/x/net v0.60.0): no new environment variables, nothing changed in `deploy/kubernetes` or `deploy/observability`, and nothing for people to notice. |
| v0.4.1 → [v0.4.2](/docs/releases/v0-4-2) | None (schema stays at 44) | A rolling upgrade: bump `?ref=` and the digests. No new environment variables, and nothing changed in `deploy/observability`. People on devices set to dark get dark mode (the account menu's **Theme** chooses). The time zone, currency, default budget and feature switches moved to **Admin → Settings**, and reranking to **Admin → Models → Reranking**. Editors can no longer change a live public or signed-in agent's profile (name, address, look, welcome); the crawl allowlist refuses private and metadata addresses. On the OpenAI-compatible endpoint, agents with tools send their answer at the end instead of streaming it. |
| v0.4.0 → [v0.4.1](/docs/releases/v0-4-1) | None (schema stays at 44) | A rolling upgrade: bump `?ref=` and the digests, and refresh the dashboards from `deploy/observability` (the SystemOne wait panels on Models and moderation). No new environment variables. Follow-up suggestions are on for every agent: set **How to turn thinking off** on reasoning chat models so they don't time out. Evaluation sets may show questions that need attention at once. "Today" in answers, and the saved-answer day, follow the platform time zone. Partly scanned PDFs processed before v0.4.1 keep their old warning (delete and upload them again). |
| v0.3.1 → [v0.4.0](/docs/releases/v0-4-0) | `00040` to `00044`, all expand-only (schema 39 → 44) | Bump `?ref=` and the digests, and refresh the dashboards from `deploy/observability` (new Reranking, Answer cache and checked-paragraph panels). No new environment variables. Public answers now stream checked paragraphs (a public moderation policy an admin saved keeps its mode) and use low reasoning effort; saved answers are on for public agents; the widget starts a new session once. Reranking stays off until an admin chooses a rerank model. |
| v0.3.0 → v0.3.1 | None | The logo, and answers that arrive whole shown from their start ([changelog](https://github.com/ncecere/grounded/blob/main/CHANGELOG.md)). Bump `?ref=` and the digests. |
| v0.2.1 or v0.2.2 → [v0.3.0](/docs/releases/v0-3-0) | `00035` to `00039`, all expand-only (schema 34 → 39) | Bump `?ref=` and the digests. Nothing new is on until an admin turns it on. Optional new settings: `HEALTH_CHECK_INTERVAL` (the scheduled health check runs by default, every 15 minutes, at no cost) and `OTEL_*` for [tracing](/docs/self-hosting/tracing), with the new `tracing` component. |
| v0.2.1 → v0.2.2 | None | Small fixes ([changelog](https://github.com/ncecere/grounded/blob/main/CHANGELOG.md)). Bump `?ref=` and the digests. |
| v0.2.0 → [v0.2.1](/docs/releases/v0-2-1) | None (schema stays at 34) | Bump `?ref=` and the digests. Some pages moved; old links redirect. |
| v0.1.0 → [v0.2.0](/docs/releases/v0-2-0) | `00030` to `00034`, additive only | Bump `?ref=` and the digest. If you vendored the base, re-vendor or switch to the remote base. The image is public, so the `private-registry` component can go. New optional settings for OCR, SSO groups and evaluations. |
| First install: [v0.1.0](/docs/releases/v0-1-0) | — | [Install on Kubernetes](/docs/self-hosting/kubernetes). |

Security fixes are released as a patch of the latest minor release; older minor releases don't get fixes, so stay on the latest release. Before 1.0, minor releases may include breaking changes; the release notes say how to adapt.

## Moved pages in v0.2.1

Admin → Legal holds and Admin → Profile migrations became tabs of Retention and Embedding profiles; a team's Crawl domains became a tab of Data sources; an agent's Versions tab moved to the version badge in the editor's header. The evaluations switch moved from Admin → Limits to Admin → Overview → Features. Old addresses redirect, so bookmarks keep working.
