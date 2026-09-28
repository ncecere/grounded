# ADR-0018: Open source and institution-neutral

- Status: Accepted; amended by [ADR-0023](0023-no-institution-data-in-the-repository.md) (where institution specifics live)
- Date: 2026-09-26

> **Note (2026-09-27):** This ADR originally named the university where Grounded was first built and tested, and placed that university's specifics in a deployment profile inside this repository. [ADR-0023](0023-no-institution-data-in-the-repository.md) replaces that part: no institution-specific profiles, themes, fixtures or data live in the repository. The institution's name has been removed from the text below; the decision is otherwise unchanged.

## Context

The project started as a platform for one university, and its first test deployment is at that university. The owner has decided it will be an open-source project that any institution or company can run, not one university's system. That university is one deployment among others.

The code is mostly generic already, but a few of that university's specifics ship to every install:
- The agent preamble names the university as the provider of the assistant.
- Migrations seed the university's domain as the crawl allowlist and describe Restricted as "FERPA… hosted by the university only".
- The UI always uses the university's theme and names it in the tagline.
- API examples use the university's domain and its AI gateway's URLs.
- DESIGN.md mixes the general design with facts about that install: its gateway, FERPA, a state public records law, its records management and security review, and on-prem Kubernetes.

## Decision

- **The product is institution-neutral.** Nothing in code, migrations, default configuration or default UI names a specific institution, gateway vendor or jurisdiction.
- **Each install supplies its identity through configuration:**
  - the product and organisation names shown in the UI and used in the agent preamble
  - the theme (the neutral bitop-ui theme)
  - optional logo and support links
  - an optional first-run seed: crawl allowlist patterns, classification descriptions and similar starting data
- **Migrations create structure, not deployment data.** Seed data moves to the first-run configuration. We edit the existing seeding migrations rather than adding new ones, because nothing runs in production yet.
- **Documentation separates the design from deployments:**
  - `DESIGN.md` describes the general system.
  - Institution specifics (gateway and models, data rules such as FERPA or public records law, retention sign-off, hosting and security review) belong in a deployment profile. *Amended by ADR-0023: profiles are kept outside the repository.*
- **Vendor-neutral examples.** Examples use `example.edu` and a generic OpenAI-compatible gateway.
- **An open-source licence: MIT** (chosen 2026-09-26, matching bitop-ui; it may be revisited). The usual community files (README positioning, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT) are added before the repository is made public.
- **The name is Grounded** (decided 2026-09-27, ADR-0022), replacing the working names "Open RAG System" and `ragd`.

## Consequences

- Other institutions can adopt the project without forking the code to remove another institution's references.
- The first install keeps its look and policies through configuration and its own deployment profile.
- Some defaults become weaker to be neutral. For example, an empty crawl allowlist means a fresh install can't crawl anything until an admin adds patterns. The first-run configuration and the admin UI must make that obvious.
- Policy wording that was institution-specific (PHI prohibited, FERPA meaning Restricted) becomes an example deployment policy rather than product behaviour. The product keeps the mechanisms: classification levels, model ceilings and audience ceilings.
- **Costs:** a one-time pass over code, UI text, OpenAPI examples and docs, and ongoing review to keep new work neutral.

## Alternatives considered

- **Stay specific to the first institution and let others fork.** Rejected: it contradicts the owner's goal and splits the community.
- **Keep the first institution as the built-in default with overrides.** Rejected: every other install would start by removing it from their product. Neutral defaults with a per-install deployment profile serve both.
