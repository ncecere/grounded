# ADR-0001: Go modular monolith

- Status: Accepted
- Date: 2026-09-24

## Context

The platform serves the API, the web UI, chat and retrieval. It also runs background ingestion: syncing, crawling, parsing, chunking, embedding, indexing, retention and usage rollups. A small team runs it with 24/7 on-call and a 99.9% target (ADR-0013). That means fewer moving parts, one release artifact, and a way to scale the API and the workers separately.

yoink, our existing Go service, already ships as a single binary with an embedded React UI. We are porting its crawler (ADR-0008) and following its delivery pipeline (ADR-0014).

## Decision

- **One Go binary,** `grounded` (named in ADR-0022; the working name was `ragd`). Its subcommands:
  - `serve`: API and worker in one process, for local development and small installs.
  - `api`: HTTP only (auth, admin, CRUD, retrieval, chat, the OpenAI-compatible endpoint).
  - `worker`: River job processing only (ADR-0003).
  - `migrate`: applies the embedded schema migrations under an advisory lock.
  - `version`: prints build information.
- **Domain modules inside one codebase.** Code is split along the design's concepts: identity and sessions, teams and membership, classification and policy, sources and ingestion, KBs and retrieval, agents and chat, conversations and analytics, usage and limits, notifications, and audit. Modules talk through Go interfaces, not over the network. Pluggable parts sit behind interfaces: `SourceType`, `Parser`, `VectorStore` and the gateway client.
- **The React UI is embedded in the binary**, as in yoink (ADR-0016). The API and the UI ship as one versioned artifact.
- **Standard library first.** Routing uses `net/http` (Go 1.22+ patterns). Other libraries are listed in DESIGN.md §15.
- **Deployment.** One image runs as separate `api` (3 or more replicas) and `worker` (2 or more replicas) Deployments. Workers can be split by queue later.

## Consequences

- One artifact to build, sign, scan and deploy by digest. The UI and the API can't drift apart in version.
- The API and the workers scale separately even though they are the same binary.
- In-process calls between modules are simpler to debug and to test.
- **Costs and risks:**
  - Module boundaries are held by convention and code review, not by the network. Without discipline, they will erode.
  - Every change rebuilds and redeploys the whole binary, UI included.
  - A memory leak or panic in shared code affects every mode that runs it.
  - During a rollout, old and new pods run side by side, so the schema has to support both versions (ADR-0013).
  - Embedding the UI means frontend-only fixes still need a full release.

## Alternatives considered

- **Microservices** (separate ingestion, retrieval, chat and admin services). Rejected. They add network hops, more deployments and more on-call surface, and we have no scaling need that a mode flag can't meet.
- **A separate binary per role.** Rejected. Subcommands in one binary give the same runtime split with one artifact.
- **Serving the UI separately** (CDN or its own container). Rejected for v1. It adds a deployment and CORS/versioning concerns, and yoink shows the embedded approach works.
