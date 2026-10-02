# ADR-0022: The product is named Grounded

- Status: Accepted; confirmed 2026-10-02 (the rename proposed in ADR-0025 was withdrawn: the project stays Grounded and fully open source)
- Date: 2026-09-27

## Context

The project was built under a working name: "Open RAG System" in prose and the UI, `open-rag-system` for the repository and Go module, and `ragd` for the binary, identifiers and environment variables (ADR-0001, DESIGN.md §18 item 8). The name had to be settled before the repository is made public (ADR-0018). The owner has an earlier TypeScript project called Grounded; it is archived as `ncecere/grounded-legacy`, which frees the name.

## Decision

- **The product is Grounded:** "an open-source, multi-tenant RAG and agents platform". The name says what the platform is for: answers grounded in a team's own sources, with citations. The default `INSTANCE_NAME` is `Grounded`; each install can still set its own (ADR-0018).
- **Identifiers are `grounded`,** renamed on 2026-09-27 from "Open RAG System" / `ragd`:
  - repository and Go module `github.com/ncecere/grounded`; binary and command `grounded` (`cmd/grounded`, `bin/grounded`, image entrypoint `/grounded`);
  - environment variables `GROUNDED_*` (was `RAGD_*`), config file `grounded.yaml`;
  - metrics `grounded_*`, Postgres `application_name`, Valkey prefix `grounded:`, cookies `grounded_*`, crawler user agent `grounded/1.0`, gateway `user` tags `grounded-…`, localStorage keys `grounded.…`, the widget's `data-grounded-widget` and `GroundedWidget`;
  - development and CI infrastructure (compose project, Postgres role and database, MinIO user and bucket).
- **Stored or derived formats keep the old strings where changing them would break existing data:**
  - the pseudonym derivation labels `ragd-pseudonym:` and `ragd-anon-pseudonym:` (changing them re-keys every stored analytics pseudonym);
  - the migration advisory lock value (ASCII "ragd" + 1), so old and new binaries share the lock;
  - the `ragd.audit_purge` setting that applied migration 00001's audit trigger checks.
- **Page markers:** parsed text is now written with `<!-- grounded:page N -->`; `<!-- ragd:page N -->` in text stored by earlier versions is still read.
- Tools whose names don't contain the product name (`ragbench`, `vecbench`, `sparkbench`, `fakeproxy`, `widgetdemo`) keep their names.

## Consequences

- Existing development environments must move to the new variable names, compose project and database role (the compose project name changes the volume names). Nothing runs in production yet, so no deployment needs migrating.
- Sessions, OIDC state cookies, anonymous widget sessions and UI preferences stored under the old names are dropped once: users sign in again and lose remembered UI choices.
- The development-login issuer changed (`ragd:development` to `grounded:development`), and users are keyed by issuer and subject. An existing development database needs `UPDATE users SET oidc_issuer = 'grounded:development' WHERE oidc_issuer = 'ragd:development'` (and the same for `platform_bootstrap`); otherwise each persona signs in as a new user without its team memberships.
- Metric names change, so dashboards and alerts written against `ragd_*` must be updated.
- Historical documents (benchmarks, UI reviews) describe past runs; their database names, paths and bitop-ui branch names (`ragd-integration`, `ragd-p4-*`, …) stay as they were.

## Alternatives considered

- **Keep "Open RAG System".** Rejected: descriptive but generic, hard to search for, and the acronym-heavy name reads as a category rather than a product.
- **Keep `ragd` as the binary name under a new product name.** Rejected: two names for one thing in commands, docs and metrics.
