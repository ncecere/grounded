/**
 * Jobs Index
 *
 * Barrel export of all job handlers for the ingestion worker.
 * Job handlers contain pure processing logic without BullMQ Worker creation.
 * Queue modules (in queues/) import these handlers and dispatch by job name.
 */

// Source run job handlers
export { processSourceRunStart } from "./source-run-start";
export { processSourceDiscover } from "./source-discover";
export { processSourceFinalize } from "./source-finalize";
export { processStageTransition } from "./stage-transition";

// Page processing job handlers
export { processPageProcess } from "./page-process";
export { processPageIndex } from "./page-index";
export { processEmbedChunks } from "./embed-chunks";
export { processEnrichPage } from "./enrich-page";

// Utility job handlers
export { processHardDelete } from "./hard-delete";
export { processKbReindex } from "./kb-reindex";
