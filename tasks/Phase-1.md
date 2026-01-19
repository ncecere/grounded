# Phase 1 - Ingestion Architecture & Contracts

## Goals
- Define a staged ingestion contract for discover → fetch → extract → chunk → embed → index.
- Establish shared error taxonomy and per-stage status reporting.
- Ensure the pipeline supports new source types without refactoring core flows.

## Tasks
- Document the ingestion stages and the required inputs/outputs for each stage.
- Define a standardized job payload schema for each stage (web and upload sources).
- Propose a shared error taxonomy with retryable/permanent categories.
- Define a per-stage status model to track start/end/error metadata.
- Identify changes needed in `packages/shared/src/types` to represent the new contracts.
- Validate backward compatibility with existing jobs and source runs.

## Deliverables
- Draft ingestion contract documentation.
- Updated shared types plan for staged ingestion.
- Error taxonomy mapping document.
