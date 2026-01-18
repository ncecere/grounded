# Phase 4 - Retry Strategy & Error Taxonomy

## Goals
- Improve reliability with consistent retry/backoff behavior.
- Categorize errors into retryable and permanent classes.

## Tasks
- Define error codes and categories for fetch/process/embed stages.
- Implement exponential backoff with jitter for retryable errors.
- Limit retry attempts with per-stage defaults.
- Add structured logging for retry attempts and final error outcome.
- Expose retry stats in run summaries (logs only for now).

## Deliverables
- Error taxonomy and retry policy document.
- Backoff implementation plan per worker.
