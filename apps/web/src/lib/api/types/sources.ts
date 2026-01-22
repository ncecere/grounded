import type {
  Source as SharedSource,
  SourceRun as SharedSourceRun,
  SourceRunStats,
  SourceRunStage,
  SourceRunStatus,
  SourceRunTrigger,
  SourceType as SharedSourceType,
} from "@grounded/shared/types/api";

export type SourceType = SharedSourceType | "api";

export type Source = Omit<SharedSource, "config" | "type"> & {
  type: SourceType;
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  lastRunStatus?: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  updatedAt: string;
};

export interface SourceRun extends SharedSourceRun {
  stageTotal: number;
  stageCompleted: number;
  stageFailed: number;
  chunksToEmbed: number;
  chunksEmbedded: number;
}

export type {
  SourceRunStats,
  SourceRunStage,
  SourceRunStatus,
  SourceRunTrigger,
};
