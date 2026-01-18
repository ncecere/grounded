# Phase 5 - Embedding Integrity

## Goals
- Prevent silent embedding gaps and ensure completion parity.
- Make embedding idempotent and traceable.

## Tasks
- Replace time-based embed job IDs with deterministic IDs (hash chunk IDs).
- Track per-chunk embed status for auditing.
- Gate source run finalization on chunks_embedded == chunks_to_embed.
- Add a "embedding_incomplete" run status when embed lags.
- Add a vector-to-chunk consistency check routine.

## Deliverables
- Embedding integrity design and idempotency plan.
- Updated run completion criteria.
