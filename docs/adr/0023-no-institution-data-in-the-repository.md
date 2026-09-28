# ADR-0023: No institution-specific data in the repository

- Status: Accepted
- Date: 2026-09-27

## Context

ADR-0018 made the product institution-neutral but kept the first install's specifics in the repository: a deployment profile in `docs/deployments/`, an example environment file in `deploy/examples/`, a bitop-ui brand theme, and test fixtures, evaluation sets and benchmark reports built from that university's website and AI gateway. Grounded's first test deployment was at a university; the repository still read as that university's project in many places.

The owner has decided that Grounded is a fully generic application: nothing in the repository references a specific institution or its services.

## Decision

- **No institution-specific profiles, themes, fixtures or data live in the repository.** This covers deployment profiles, environment files, UI themes, test fixtures and test data, fake gateway text, evaluation sets, and benchmark reports that name an institution.
- **Deployment profiles are kept by each install, outside the repository.** `docs/deployments/README.md` keeps a neutral template and checklist; `deploy/examples/example.env` is a neutral example using `example.edu`.
- **One theme ships:** `neutral`. `UI_THEME` stays as a setting for future generic themes and rejects anything else. Branding comes from `INSTANCE_NAME`, `ORG_NAME` and `UI_LOGO_URL`.
- **Tests and fixtures use neutral names:** `example.edu`, `registrar.example.edu`, "Example University", "campus ID", "student portal".
- **Evaluation data built from a third party's site is not published.** Benchmark reports describe such data generically (for example "a public university registrar website, 58 pages") and describe the file format so others can build their own sets. The files are kept privately by the owner. Public datasets (BEIR FiQA) and sets written for the project stay.
- **Gateways are described by behaviour, not name** ("some gateways report embedding `prompt_tokens` as characters"). The owner's personal infrastructure hostnames are replaced with placeholders.
- This amends ADR-0018's "institution specifics live in `docs/deployments/`"; the rest of ADR-0018 stands.

## Consequences

- An adopter sees no other institution's data, names or branding anywhere in the code, tests or docs.
- Benchmark numbers on the registrar set can't be reproduced from the repository alone. The reports keep every number, table and conclusion and say how to build an equivalent set.
- The first install must keep its profile, theme (if it wants one) and environment file in its own configuration.
- Review keeps new work neutral: a pull request that adds an institution's name, domain or data to the repository is out of scope.

## Alternatives considered

- **Keep the first install's profile in the repository as a worked example.** Rejected: an example is useful, but a neutral template does the same job without publishing one institution's policies, open questions and infrastructure.
- **Keep the brand theme as an opt-in.** Rejected: it names the institution in the shipped UI assets. Themes can come back as generic options.
- **Publish the evaluation sets.** Rejected: they contain a third party's site content and URLs.
