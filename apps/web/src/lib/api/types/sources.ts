export interface Source {
  id: string;
  kbId: string;
  name: string;
  type: "web" | "upload" | "api";
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  lastRunStatus?: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRunStats {
  pagesSeen: number;
  pagesIndexed: number;
  pagesFailed: number;
  tokensEstimated: number;
}

export type SourceRunStage =
  | "discovering"
  | "scraping"
  | "processing"
  | "indexing"
  | "embedding"
  | "completed";

export interface SourceRun {
  id: string;
  sourceId: string;
  tenantId: string | null;
  status: "pending" | "running" | "partial" | "succeeded" | "failed" | "canceled";
  stage: SourceRunStage | null;
  trigger: "manual" | "scheduled";
  startedAt: string | null;
  finishedAt: string | null;
  stats: SourceRunStats;
  stageTotal: number;
  stageCompleted: number;
  stageFailed: number;
  chunksToEmbed: number;
  chunksEmbedded: number;
  error: string | null;
  createdAt: string;
}
