# ADR-0007: Embedding profiles

- Status: Accepted
- Date: 2026-09-24

> **Note (2026-09-26):** Admins create profiles; the nomic profile below is the tested recommendation for any install, and "hosted by the institution" describes the first install only. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

> **Note (2026-09-27): as built** (docs/phase5-deploy.md §5 P2, [runbook](../operations/profile-migration.md)). The migration works per knowledge base, as decided below. A source keeps its own profile (`data_sources.embedding_profile_id`) and gains extra *embedding sets* for other profiles while a migration, or another knowledge base using it, needs them. Chunks belong to a profile (`chunks.profile_id`): a target with the same passage settings gets copies of the passages, one with other settings gets them cut again from the stored parsed text, so changing chunker settings is a migration too. The knowledge base switches in one transaction once every source is complete; the old vectors are kept for a grace period (`PROFILE_MIGRATION_GRACE_DAYS`, default 7) during which it can switch back. Platform admins run migrations. Maintenance mode is optional and doesn't pause them.

## Context

Embeddings are only comparable when they come from the same model, with the same dimensions, prefixes and chunking. Models change over time, and some data (Restricted) may only be embedded by certain models (ADR-0006). pgvector needs a fixed dimension per column (ADR-0004). We need a named, platform-managed unit that holds all of these settings, and a safe way to move data from one unit to another.

## Decision

- **An embedding profile** is platform-owned and defines:
  - embedding model (from the gateway catalog, ADR-0005)
  - dimensions and storage type
  - document prefix and query prefix
  - chunk size, overlap and chunker version
- Profiles must fit pgvector's HNSW limits: at most 2,000 dims for `vector` and 4,000 for `halfvec`.
- **Each data source has exactly one profile.** Its chunks are embedded with that profile's model and prefixes and stored in that profile's vector table.
- **One profile per KB.** All sources in a KB share the same profile.
- **Agents can span profiles.** An agent version may reference KBs with different profiles. Each KB is searched with its own profile, including its query prefix, and the results are merged with RRF.
- **The profile's embedding model must be tagged** with a max rank ≥ the source's classification (ADR-0006 rule 4).
- **Switching profiles is a migration, never an in-place change.**
  - An admin creates a new profile and starts a migration.
  - Each source is re-embedded in the background. The work is throttled and resumable, then the source switches over atomically.
  - A KB moves once all its sources have moved.
  - Maintenance mode (ADR-0013) can pause new ingestion during large migrations.
- **Default profile:** `nomic-embed-text-v1.5`, 768 dims, `halfvec`, document prefix `search_document:` and query prefix `search_query:`, hosted by the institution.

## Consequences

- Vectors in a table always come from the same model and settings, so similarity scores are meaningful.
- Adopting a new model needs no code change, only a new profile and a migration.
- Chunker settings are versioned with the profile, so changing them also goes through a controlled migration.
- **Costs and risks:**
  - A migration re-embeds everything. At backfill scale this is days of gateway load and double vector storage until the old data is removed.
  - Migrations switch **per KB**, so a KB never mixes profiles. Sources keep their old vectors until every KB using them has switched. A source shared by several KBs temporarily stores two sets of vectors, which costs storage.
  - Sources whose profile differs from a KB's profile can't be attached to it. Teams will occasionally hit that error.
  - Wrong prefixes silently hurt retrieval quality. They must come from the profile and never be hard-coded.

## Alternatives considered

- **Changing a source's profile in place.** Rejected. Old and new vectors would be mixed in one index.
- **Allowing mixed profiles in one KB.** Rejected. Fusing scores across models inside a KB complicates retrieval. Mixed profiles are allowed only across KBs within an agent.
- **One global model.** Rejected. It blocks model upgrades and classification-specific models.
