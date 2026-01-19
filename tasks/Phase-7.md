# Phase 7 - Observability & Reporting

## Goals
- Provide operational visibility for enterprise ingestion.
- Report high-volume success/failure reasons via logs.

## Tasks
- Add per-stage throughput and latency metrics.
- Emit run summary logs: totals, skipped_non_html, failed, embedded.
- Log error breakdown by category for each run.
- Track queue depth and saturation signals.
- Add vector/chunk consistency checks to reporting.

## Deliverables
- Observability dashboard spec (metrics + logs).
- Run summary log format definition.
