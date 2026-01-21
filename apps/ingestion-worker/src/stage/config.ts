import { log } from "@grounded/logger";
import { getEnv } from "@grounded/shared";

export interface StageManagerConfig {
  /** Number of jobs to queue at once per stage */
  batchSize: number;
  /** Jobs per second per run (for rate limiting) */
  jobsPerSecondPerRun: number;
}

function getDefaultConfig(): StageManagerConfig {
  return {
    batchSize: parseInt(getEnv("STAGE_BATCH_SIZE", "100"), 10),
    jobsPerSecondPerRun: parseInt(getEnv("JOBS_PER_SECOND_PER_RUN", "10"), 10),
  };
}

let config: StageManagerConfig | null = null;

export function getStageManagerConfig(): StageManagerConfig {
  if (!config) {
    config = getDefaultConfig();
  }
  return { ...config };
}

export function setStageManagerConfig(newConfig: Partial<StageManagerConfig>): void {
  config = { ...getStageManagerConfig(), ...newConfig };
  log.info("ingestion-worker", "Stage manager config updated", { config });
}
