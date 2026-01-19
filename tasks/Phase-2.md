# Phase 2 - High-Volume Queueing & Backpressure

## Goals
- Support 1,000+ pages per run with predictable throughput.
- Introduce backpressure and concurrency controls per tenant/domain.

## Tasks
- Split queues by stage (discover, fetch, process, embed, index, upload).
- Define queue concurrency defaults and per-tenant overrides.
- Add per-domain concurrency caps and optional crawl delay.
- Implement embed lag detection to throttle process queue.
- Add queue health metrics and alert thresholds.
- Update worker configuration to support scaling per stage.

## Deliverables
- Queue topology design.
- Backpressure and concurrency policy spec.
- Worker configuration changes plan.
