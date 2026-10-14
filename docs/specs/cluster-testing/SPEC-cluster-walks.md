# Spec: `cluster-walks`: QA walks and screenshot capture against a cluster environment

Status: **DRAFT** (2026-10-14). The decisions below are recommendations, applied unless overruled.
Part of [`SPEC.md`](SPEC.md) (module 3 of 4; needs `env-complete` and, for the runner image, `cluster-tests`). Tracks [#47](https://github.com/ncecere/grounded/issues/47).

> Where the code lives: the capture script and its manifest are here (`web/walk/`), because they change with the UI. The command
> (`dev-env walk`) is in the homelab repo (`ncecere/homelab`, private), like the rest of `dev-env`.

## Objective

A QA walk looks at the running product as each kind of person and records what it sees: the `docs/ui-review` work captured 117
persona and page combinations at two widths and checked each for accessibility violations, console errors and sideways overflow. That
was done by hand against a compose stack, a mock gateway and seed scripts on a laptop.

`dev-env walk grounded <name>` does the capture on the cluster, against an environment that is already up with `--demo`: it signs in as
each development persona, opens each page of a manifest at each width, takes the screenshot, and records the checks, so a walk is
repeatable and its output comparable between two refs. It replaces the laptop capture stack; it does not replace looking at the
screenshots.

## What it needs and what it replaces

| Laptop stack | On the cluster |
|---|---|
| compose Postgres, Valkey, S3 | the environment's own (`dev-env up`) |
| a mock model gateway and seed scripts | `--demo`: the fake gateway and the Demo team, agents and knowledge base |
| personas created by hand | the six development personas (`DEV_AUTH`, `POST /auth/dev`) |
| a browser on the laptop | Chromium in the runner image, in a Job |

## Decisions

- **W1: the capture runs as a Job on the cluster**, in the `grounded-ci` runner image (it already has Chromium and Playwright), not in a
  browser on the laptop. The development sign-in only works when the request's host is the loopback `APP_URL`
  (`http://localhost:<port>`), so the Job runs a small loopback forward to the environment's Service in its own pod; the browser
  believes it is on `localhost:<port>`. Screenshots and the report go to the run's artifact bucket and are fetched with
  `dev-env walk fetch`, as for `cluster-tests`.
- **W2: a walk is a manifest, `web/walk/walks.json`, in the Grounded repo**: the persona, the path, optionally an element to wait for,
  and the widths (default 1440, 1280, 390). It starts as pages only. Flows that click through (create an agent, publish) are added as
  named Playwright functions beside it when a walk needs one, not as a second language in the manifest.
- **W3: every capture is also checked**, with what the earlier walks reported: WCAG A and AA violations (`@axe-core/playwright`, already
  a dependency), console errors and uncaught page errors, and sideways overflow. The report is `report.json` plus a one-line summary
  per page; the command exits non-zero if any check fails, so a walk can gate nothing but still tells a script the result.
- **W4: it needs `--demo`**; without the Demo team there is almost nothing to look at, so `dev-env walk` refuses an environment that
  was not created with it, naming the flag. `--no-crawl` is fine (the pages exist; only retrieval content is missing).
- **W5: screenshots are not committed.** They are artifacts of a run, compared by eye or by the report. Screenshots for the docs and
  the website stay a separate, deliberate step.

## Assumptions (correct me)

1. The runner image needs one addition for W1, a loopback forwarder (`socat`), which changes `Dockerfile.ci` and so its tag; the
   `ci-image` workflow publishes the new image and the command picks it up from the ref's file, as `cluster-tests` does.
2. The manifest covers the pages of the six personas that the Demo seed gives content to; pages that need other data (a failed
   document, a spend report) are reached by a named flow, later.
3. A walk of the full manifest (about 60 pages at three widths) takes a few minutes on the cluster.

## Commands

```
dev-env walk grounded <name> [--persona admin,alex,...] [--widths 1440,1280,390] [--manifest FILE]   # default: the ref's web/walk/walks.json
dev-env walk fetch grounded <name> [--dest DIR]       # screenshots, report.json, the page and console logs
```

`<name>` is an environment created with `dev-env up grounded <name> --ref R --demo [--no-crawl]`. The walk is a Job in the same
namespace, labelled with the environment, so `dev-env down` and the reaper remove it with the rest.

## Success criteria

1. On a `--demo` environment of `main`, a walk of the manifest produces a screenshot for every persona, page and width in it, and a
   report with the three checks for each.
2. A page that is deliberately broken (a console error, an axe violation, a horizontal overflow) is reported, and the command
   exits non-zero; a clean manifest exits zero.
3. The same walk of two refs gives two reports that `report.json` makes comparable (the same keys, in the same order).
4. `dev-env walk` refuses an environment without `--demo`, and one that does not exist, touching nothing.
5. After `down`, nothing of the walk remains in the namespace.
6. Nothing of OCI or OMG is touched.

## Boundaries

- **Always:** sign in through the persona sign-in only; keep every artifact in the run's own bucket; read real exit codes.
- **Ask first:** adding a persona, a path that changes data, or a flow that creates or deletes anything in the environment.
- **Never:** a stored credential; walking the production namespace or any URL but the environment's; OCI or OMG.

## Testing strategy

Unit tests (no cluster) for the manifest (validation, the expansion into persona, page and width), the Job manifest, the report
format and the refusals. A script on the cluster (`tests/cluster_walks_accept.py`) walks a `--demo` environment and a deliberately
broken page and checks the criteria above, always tearing down.
