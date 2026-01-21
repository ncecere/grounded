/**
 * Stage Manager - Handles sequential stage transitions for source runs
 *
 * Stages flow: DISCOVERING → SCRAPING → PROCESSING → INDEXING → EMBEDDING → COMPLETED
 *
 * Each stage must complete fully before the next begins.
 * Jobs are queued in batches to keep queue size manageable.
 */

export * from "./stage/config";
export * from "./stage/progress";
export * from "./stage/transitions";
export * from "./stage/cleanup";
export * from "./stage/priority";
export * from "./stage/queue-scraping";
export * from "./stage/queue-processing";
export * from "./stage/queue-indexing";
export * from "./stage/queue-embedding";
