# ADR-0004: Vector store interface, pgvector first

- Status: Accepted (pgvector subject to the benchmark gate)
- Date: 2026-09-24

## Context

The planning estimate is 10–50M chunks. At 768 dimensions stored as `halfvec`, that is about 15–75 GB of vectors before indexes. Retrieval is always filtered to a KB's source IDs, and later to metadata and ACL filters. Some KBs are small inside a very large table, which is the hard case for filtered approximate search. We don't yet know whether pgvector meets our recall and latency needs at this scale. We don't want that uncertainty to block v1 or lock us in.

## Decision

- **All vector access goes through a `VectorStore` interface:** `EnsureProfile`, `Upsert`, `DeleteDocuments` and `Search`. `Search` requires `Filter.SourceIDs`, so every search is scoped to a KB. The signatures are in DESIGN.md §9.
- **The v1 implementation is pgvector** in the main Postgres (ADR-0003):
  - Vectors are stored as `halfvec` with an HNSW index.
  - **There is one table per embedding profile** (ADR-0007), because pgvector needs a fixed dimension per column. Each row maps a chunk ID to its vector, with payload: source ID, document ID and filterable metadata.
  - Filtered queries rely on the iterative index scans added in pgvector 0.8.
  - **Dimension limits:** HNSW supports at most 2,000 dims for `vector` and 4,000 for `halfvec`. Admins can only create embedding profiles within those limits.
- **Lexical search stays in Postgres** (`tsvector`) whichever vector backend is used. Results are merged with RRF in the application.
- **Benchmark gate at the end of Phase 1:**
  - 20M synthetic 768-dim vectors.
  - Realistic filters: small, medium and large KBs, plus metadata filters.
  - Targets for recall@10 and p95 latency.
  - If pgvector misses the targets, we write a **Qdrant** implementation of the same interface.
  - Either way, vectors can move to their own cluster without code changes.
- The final pgvector-versus-Qdrant choice is open until the gate (DESIGN.md §18 item 2).

## Consequences

- v1 needs no extra stateful system. Vectors are backed up and restored with Postgres.
- Domain code doesn't know which store is in use, so swapping it later only affects the adapter.
- **Costs and risks:**
  - HNSW indexes over tens of millions of rows use a lot of memory and take a long time to build. They compete with OLTP and queue load on the same cluster.
  - Filtered HNSW recall for small KBs in large tables is the main risk. The gate exists to measure it.
  - A table per profile means DDL at runtime (`EnsureProfile`) and more tables to manage.
  - The interface is limited to what both backends can do, which may rule out backend-specific features.
  - If Qdrant is adopted, we gain a stateful system to run, back up and include in DR.

## Alternatives considered

- **Qdrant from day one.** Deferred. It adds operational load before we know we need it. It stays the fallback behind the same interface.
- **One shared vector table with a dimension column.** Not possible. pgvector needs a fixed dimension per column.
- **Full-precision `vector`.** Rejected as the default. `halfvec` halves storage and allows larger HNSW dimensions.
