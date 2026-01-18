import { describe, it, expect } from "bun:test";
import {
  QUEUE_NAMES,
  INGESTION_STAGES,
  STAGE_QUEUE_MAPPING,
  STAGE_DEFAULT_CONCURRENCY,
  STAGE_CONCURRENCY_ENV_VARS,
  QUEUE_DEFAULT_CONCURRENCY,
  QUEUE_CONCURRENCY_ENV_VARS,
} from "../constants";
import type { QueueName, QueueConfig, IngestionStage } from "./index";
import {
  getQueueForStage,
  getStageConcurrency,
  getStageConcurrencyEnvVar,
  getQueueConcurrency,
  getQueueConcurrencyEnvVar,
  getStagesForQueue,
  buildQueueConfigMap,
  resolveQueueConcurrency,
  resolveStageConcurrency,
} from "./index";

describe("Queue Configuration", () => {
  describe("STAGE_QUEUE_MAPPING", () => {
    it("should map all 6 ingestion stages to queues", () => {
      expect(Object.keys(STAGE_QUEUE_MAPPING)).toHaveLength(6);
    });

    it("should map discover stage to source-run queue", () => {
      expect(STAGE_QUEUE_MAPPING.discover).toBe(QUEUE_NAMES.SOURCE_RUN);
    });

    it("should map fetch stage to page-fetch queue", () => {
      expect(STAGE_QUEUE_MAPPING.fetch).toBe(QUEUE_NAMES.PAGE_FETCH);
    });

    it("should map extract stage to page-process queue", () => {
      expect(STAGE_QUEUE_MAPPING.extract).toBe(QUEUE_NAMES.PAGE_PROCESS);
    });

    it("should map chunk stage to page-process queue", () => {
      expect(STAGE_QUEUE_MAPPING.chunk).toBe(QUEUE_NAMES.PAGE_PROCESS);
    });

    it("should map embed stage to embed-chunks queue", () => {
      expect(STAGE_QUEUE_MAPPING.embed).toBe(QUEUE_NAMES.EMBED_CHUNKS);
    });

    it("should map index stage to embed-chunks queue", () => {
      expect(STAGE_QUEUE_MAPPING.index).toBe(QUEUE_NAMES.EMBED_CHUNKS);
    });
  });

  describe("STAGE_DEFAULT_CONCURRENCY", () => {
    it("should define concurrency for all 6 stages", () => {
      expect(Object.keys(STAGE_DEFAULT_CONCURRENCY)).toHaveLength(6);
    });

    it("should have discover concurrency of 2 (low to avoid overwhelming sources)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.discover).toBe(2);
    });

    it("should have fetch concurrency of 5 (moderate for network-bound)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.fetch).toBe(5);
    });

    it("should have extract concurrency of 10 (CPU-bound, parallelizable)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.extract).toBe(10);
    });

    it("should have chunk concurrency of 10 (lightweight CPU-bound)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.chunk).toBe(10);
    });

    it("should have embed concurrency of 4 (API rate limited)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.embed).toBe(4);
    });

    it("should have index concurrency of 8 (database-bound)", () => {
      expect(STAGE_DEFAULT_CONCURRENCY.index).toBe(8);
    });

    it("should have positive values for all stages", () => {
      for (const stage of INGESTION_STAGES) {
        expect(STAGE_DEFAULT_CONCURRENCY[stage]).toBeGreaterThan(0);
      }
    });
  });

  describe("STAGE_CONCURRENCY_ENV_VARS", () => {
    it("should define env vars for all 6 stages", () => {
      expect(Object.keys(STAGE_CONCURRENCY_ENV_VARS)).toHaveLength(6);
    });

    it("should have consistent naming pattern", () => {
      expect(STAGE_CONCURRENCY_ENV_VARS.discover).toBe("DISCOVER_CONCURRENCY");
      expect(STAGE_CONCURRENCY_ENV_VARS.fetch).toBe("FETCH_CONCURRENCY");
      expect(STAGE_CONCURRENCY_ENV_VARS.extract).toBe("EXTRACT_CONCURRENCY");
      expect(STAGE_CONCURRENCY_ENV_VARS.chunk).toBe("CHUNK_CONCURRENCY");
      expect(STAGE_CONCURRENCY_ENV_VARS.embed).toBe("EMBED_CONCURRENCY");
      expect(STAGE_CONCURRENCY_ENV_VARS.index).toBe("INDEX_CONCURRENCY");
    });
  });

  describe("QUEUE_DEFAULT_CONCURRENCY", () => {
    it("should define concurrency for all 7 queues", () => {
      expect(Object.keys(QUEUE_DEFAULT_CONCURRENCY)).toHaveLength(7);
    });

    it("should have source-run concurrency of 5", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.SOURCE_RUN]).toBe(5);
    });

    it("should have page-fetch concurrency of 5", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.PAGE_FETCH]).toBe(5);
    });

    it("should have page-process concurrency of 5", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.PAGE_PROCESS]).toBe(5);
    });

    it("should have embed-chunks concurrency of 4", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.EMBED_CHUNKS]).toBe(4);
    });

    it("should have enrich-page concurrency of 2", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.ENRICH_PAGE]).toBe(2);
    });

    it("should have deletion concurrency of 2", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.DELETION]).toBe(2);
    });

    it("should have kb-reindex concurrency of 1 (avoid contention)", () => {
      expect(QUEUE_DEFAULT_CONCURRENCY[QUEUE_NAMES.KB_REINDEX]).toBe(1);
    });
  });

  describe("QUEUE_CONCURRENCY_ENV_VARS", () => {
    it("should define env vars for all 7 queues", () => {
      expect(Object.keys(QUEUE_CONCURRENCY_ENV_VARS)).toHaveLength(7);
    });

    it("should have consistent naming pattern", () => {
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.SOURCE_RUN]).toBe("SOURCE_RUN_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.PAGE_FETCH]).toBe("PAGE_FETCH_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.PAGE_PROCESS]).toBe("PAGE_PROCESS_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.EMBED_CHUNKS]).toBe("EMBED_CHUNKS_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.ENRICH_PAGE]).toBe("ENRICH_PAGE_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.DELETION]).toBe("DELETION_CONCURRENCY");
      expect(QUEUE_CONCURRENCY_ENV_VARS[QUEUE_NAMES.KB_REINDEX]).toBe("KB_REINDEX_CONCURRENCY");
    });
  });
});

describe("Queue Configuration Helper Functions", () => {
  describe("getQueueForStage", () => {
    it("should return correct queue for discover stage", () => {
      expect(getQueueForStage("discover")).toBe(QUEUE_NAMES.SOURCE_RUN);
    });

    it("should return correct queue for fetch stage", () => {
      expect(getQueueForStage("fetch")).toBe(QUEUE_NAMES.PAGE_FETCH);
    });

    it("should return correct queue for extract stage", () => {
      expect(getQueueForStage("extract")).toBe(QUEUE_NAMES.PAGE_PROCESS);
    });

    it("should return correct queue for chunk stage", () => {
      expect(getQueueForStage("chunk")).toBe(QUEUE_NAMES.PAGE_PROCESS);
    });

    it("should return correct queue for embed stage", () => {
      expect(getQueueForStage("embed")).toBe(QUEUE_NAMES.EMBED_CHUNKS);
    });

    it("should return correct queue for index stage", () => {
      expect(getQueueForStage("index")).toBe(QUEUE_NAMES.EMBED_CHUNKS);
    });
  });

  describe("getStageConcurrency", () => {
    it("should return correct concurrency for each stage", () => {
      expect(getStageConcurrency("discover")).toBe(2);
      expect(getStageConcurrency("fetch")).toBe(5);
      expect(getStageConcurrency("extract")).toBe(10);
      expect(getStageConcurrency("chunk")).toBe(10);
      expect(getStageConcurrency("embed")).toBe(4);
      expect(getStageConcurrency("index")).toBe(8);
    });
  });

  describe("getStageConcurrencyEnvVar", () => {
    it("should return correct env var for each stage", () => {
      expect(getStageConcurrencyEnvVar("discover")).toBe("DISCOVER_CONCURRENCY");
      expect(getStageConcurrencyEnvVar("fetch")).toBe("FETCH_CONCURRENCY");
      expect(getStageConcurrencyEnvVar("embed")).toBe("EMBED_CONCURRENCY");
    });
  });

  describe("getQueueConcurrency", () => {
    it("should return correct concurrency for each queue", () => {
      expect(getQueueConcurrency(QUEUE_NAMES.SOURCE_RUN)).toBe(5);
      expect(getQueueConcurrency(QUEUE_NAMES.PAGE_FETCH)).toBe(5);
      expect(getQueueConcurrency(QUEUE_NAMES.EMBED_CHUNKS)).toBe(4);
      expect(getQueueConcurrency(QUEUE_NAMES.KB_REINDEX)).toBe(1);
    });
  });

  describe("getQueueConcurrencyEnvVar", () => {
    it("should return correct env var for each queue", () => {
      expect(getQueueConcurrencyEnvVar(QUEUE_NAMES.SOURCE_RUN)).toBe("SOURCE_RUN_CONCURRENCY");
      expect(getQueueConcurrencyEnvVar(QUEUE_NAMES.EMBED_CHUNKS)).toBe("EMBED_CHUNKS_CONCURRENCY");
    });
  });

  describe("getStagesForQueue", () => {
    it("should return discover for source-run queue", () => {
      const stages = getStagesForQueue(QUEUE_NAMES.SOURCE_RUN);
      expect(stages).toContain("discover");
      expect(stages).toHaveLength(1);
    });

    it("should return fetch for page-fetch queue", () => {
      const stages = getStagesForQueue(QUEUE_NAMES.PAGE_FETCH);
      expect(stages).toContain("fetch");
      expect(stages).toHaveLength(1);
    });

    it("should return extract and chunk for page-process queue", () => {
      const stages = getStagesForQueue(QUEUE_NAMES.PAGE_PROCESS);
      expect(stages).toContain("extract");
      expect(stages).toContain("chunk");
      expect(stages).toHaveLength(2);
    });

    it("should return embed and index for embed-chunks queue", () => {
      const stages = getStagesForQueue(QUEUE_NAMES.EMBED_CHUNKS);
      expect(stages).toContain("embed");
      expect(stages).toContain("index");
      expect(stages).toHaveLength(2);
    });

    it("should return empty array for queues without stages", () => {
      const stages = getStagesForQueue(QUEUE_NAMES.DELETION);
      expect(stages).toHaveLength(0);
    });
  });

  describe("buildQueueConfigMap", () => {
    it("should return a map with all 7 queues", () => {
      const configMap = buildQueueConfigMap();
      expect(configMap.size).toBe(7);
    });

    it("should include correct config for source-run queue", () => {
      const configMap = buildQueueConfigMap();
      const config = configMap.get(QUEUE_NAMES.SOURCE_RUN);
      expect(config).toBeDefined();
      expect(config?.name).toBe(QUEUE_NAMES.SOURCE_RUN);
      expect(config?.defaultConcurrency).toBe(5);
      expect(config?.concurrencyEnvVar).toBe("SOURCE_RUN_CONCURRENCY");
      expect(config?.stages).toContain("discover");
    });

    it("should include correct config for page-process queue", () => {
      const configMap = buildQueueConfigMap();
      const config = configMap.get(QUEUE_NAMES.PAGE_PROCESS);
      expect(config).toBeDefined();
      expect(config?.stages).toContain("extract");
      expect(config?.stages).toContain("chunk");
    });

    it("should have valid QueueConfig type for all entries", () => {
      const configMap = buildQueueConfigMap();
      for (const [queueName, config] of configMap) {
        expect(config.name).toBe(queueName);
        expect(typeof config.defaultConcurrency).toBe("number");
        expect(typeof config.concurrencyEnvVar).toBe("string");
        expect(Array.isArray(config.stages)).toBe(true);
      }
    });
  });

  describe("resolveQueueConcurrency", () => {
    it("should return default when env var not set", () => {
      const getEnv = (_key: string) => undefined;
      expect(resolveQueueConcurrency(QUEUE_NAMES.SOURCE_RUN, getEnv)).toBe(5);
      expect(resolveQueueConcurrency(QUEUE_NAMES.EMBED_CHUNKS, getEnv)).toBe(4);
    });

    it("should return env var value when set", () => {
      const getEnv = (key: string) => {
        if (key === "SOURCE_RUN_CONCURRENCY") return "10";
        return undefined;
      };
      expect(resolveQueueConcurrency(QUEUE_NAMES.SOURCE_RUN, getEnv)).toBe(10);
    });

    it("should return default for invalid env var value", () => {
      const getEnv = (key: string) => {
        if (key === "SOURCE_RUN_CONCURRENCY") return "invalid";
        return undefined;
      };
      expect(resolveQueueConcurrency(QUEUE_NAMES.SOURCE_RUN, getEnv)).toBe(5);
    });

    it("should return default for zero or negative env var value", () => {
      const getEnvZero = (_key: string) => "0";
      const getEnvNegative = (_key: string) => "-5";
      expect(resolveQueueConcurrency(QUEUE_NAMES.SOURCE_RUN, getEnvZero)).toBe(5);
      expect(resolveQueueConcurrency(QUEUE_NAMES.SOURCE_RUN, getEnvNegative)).toBe(5);
    });

    it("should parse env var as integer", () => {
      const getEnv = (key: string) => {
        if (key === "EMBED_CHUNKS_CONCURRENCY") return "8";
        return undefined;
      };
      expect(resolveQueueConcurrency(QUEUE_NAMES.EMBED_CHUNKS, getEnv)).toBe(8);
    });
  });

  describe("resolveStageConcurrency", () => {
    it("should return default when env var not set", () => {
      const getEnv = (_key: string) => undefined;
      expect(resolveStageConcurrency("discover", getEnv)).toBe(2);
      expect(resolveStageConcurrency("embed", getEnv)).toBe(4);
    });

    it("should return env var value when set", () => {
      const getEnv = (key: string) => {
        if (key === "DISCOVER_CONCURRENCY") return "5";
        return undefined;
      };
      expect(resolveStageConcurrency("discover", getEnv)).toBe(5);
    });

    it("should return default for invalid env var value", () => {
      const getEnv = (key: string) => {
        if (key === "FETCH_CONCURRENCY") return "abc";
        return undefined;
      };
      expect(resolveStageConcurrency("fetch", getEnv)).toBe(5);
    });

    it("should return default for zero or negative env var value", () => {
      const getEnvZero = (_key: string) => "0";
      expect(resolveStageConcurrency("chunk", getEnvZero)).toBe(10);
    });
  });
});

describe("QueueName type", () => {
  it("should accept all valid queue names", () => {
    const validNames: QueueName[] = [
      "source-run",
      "page-fetch",
      "page-process",
      "embed-chunks",
      "enrich-page",
      "deletion",
      "kb-reindex",
    ];
    expect(validNames).toHaveLength(7);
  });
});

describe("QueueConfig interface", () => {
  it("should accept valid config object", () => {
    const config: QueueConfig = {
      name: "source-run",
      defaultConcurrency: 5,
      concurrencyEnvVar: "SOURCE_RUN_CONCURRENCY",
      stages: ["discover"],
    };
    expect(config.name).toBe("source-run");
    expect(config.defaultConcurrency).toBe(5);
    expect(config.stages).toContain("discover");
  });
});

describe("Cross-validation", () => {
  it("should have all INGESTION_STAGES mapped to queues", () => {
    for (const stage of INGESTION_STAGES) {
      expect(STAGE_QUEUE_MAPPING[stage]).toBeDefined();
    }
  });

  it("should have all INGESTION_STAGES with concurrency defaults", () => {
    for (const stage of INGESTION_STAGES) {
      expect(STAGE_DEFAULT_CONCURRENCY[stage]).toBeDefined();
      expect(STAGE_DEFAULT_CONCURRENCY[stage]).toBeGreaterThan(0);
    }
  });

  it("should have all INGESTION_STAGES with concurrency env vars", () => {
    for (const stage of INGESTION_STAGES) {
      expect(STAGE_CONCURRENCY_ENV_VARS[stage]).toBeDefined();
      expect(typeof STAGE_CONCURRENCY_ENV_VARS[stage]).toBe("string");
    }
  });

  it("should have all QUEUE_NAMES with concurrency defaults", () => {
    for (const queueName of Object.values(QUEUE_NAMES)) {
      expect(QUEUE_DEFAULT_CONCURRENCY[queueName]).toBeDefined();
      expect(QUEUE_DEFAULT_CONCURRENCY[queueName]).toBeGreaterThan(0);
    }
  });

  it("should have all QUEUE_NAMES with concurrency env vars", () => {
    for (const queueName of Object.values(QUEUE_NAMES)) {
      expect(QUEUE_CONCURRENCY_ENV_VARS[queueName]).toBeDefined();
      expect(typeof QUEUE_CONCURRENCY_ENV_VARS[queueName]).toBe("string");
    }
  });

  it("should map stages to valid queue names", () => {
    const validQueueNames = Object.values(QUEUE_NAMES);
    for (const stage of INGESTION_STAGES) {
      expect(validQueueNames).toContain(STAGE_QUEUE_MAPPING[stage]);
    }
  });
});
