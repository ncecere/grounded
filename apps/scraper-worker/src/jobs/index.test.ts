/**
 * Jobs Index Tests
 *
 * Tests for the scraper worker jobs index module.
 * Validates:
 * 1. Job handler exports are available
 * 2. Job registry contains all expected jobs
 * 3. Job lookup utilities work correctly
 * 4. Registry metadata is accurate
 */

import { describe, expect, test } from "bun:test";
import { QUEUE_NAMES } from "@grounded/shared";

import {
  // Job handler exports
  handlePageFetch,
  processPageFetch,
  // Job object exports
  pageFetchJob,
  // Registry exports
  jobRegistry,
  jobsByQueue,
  // Utility exports
  getJobHandler,
  getPageFetchHandler,
  getRegisteredJobNames,
  getJobCount,
  jobRequiresBrowser,
  getJobRegistration,
  // Type exports
  type JobHandler,
  type PageFetchHandler,
  type JobRegistration,
} from "./index";

// ============================================================================
// Job Handler Export Tests
// ============================================================================

describe("Job Handler Exports", () => {
  test("handlePageFetch is exported and is a function", () => {
    expect(handlePageFetch).toBeDefined();
    expect(typeof handlePageFetch).toBe("function");
  });

  test("processPageFetch is re-exported for backward compatibility", () => {
    expect(processPageFetch).toBeDefined();
    expect(typeof processPageFetch).toBe("function");
  });
});

// ============================================================================
// Page Fetch Job Object Tests
// ============================================================================

describe("pageFetchJob Object", () => {
  test("has correct name", () => {
    expect(pageFetchJob.name).toBe("fetch");
  });

  test("has correct queue name matching QUEUE_NAMES.PAGE_FETCH", () => {
    expect(pageFetchJob.queue).toBe(QUEUE_NAMES.PAGE_FETCH);
    expect(pageFetchJob.queue).toBe("page-fetch");
  });

  test("has a handler function", () => {
    expect(pageFetchJob.handler).toBeDefined();
    expect(typeof pageFetchJob.handler).toBe("function");
  });

  test("has a description", () => {
    expect(pageFetchJob.description).toBeDefined();
    expect(typeof pageFetchJob.description).toBe("string");
    expect(pageFetchJob.description.length).toBeGreaterThan(0);
  });

  test("requiresBrowser is true", () => {
    expect(pageFetchJob.requiresBrowser).toBe(true);
  });

  test("handler matches handlePageFetch", () => {
    expect(pageFetchJob.handler).toBe(handlePageFetch);
  });
});

// ============================================================================
// Job Registry Tests
// ============================================================================

describe("jobRegistry", () => {
  test("is an array", () => {
    expect(Array.isArray(jobRegistry)).toBe(true);
  });

  test("contains exactly one job (page-fetch)", () => {
    expect(jobRegistry.length).toBe(1);
  });

  test("contains pageFetchJob", () => {
    expect(jobRegistry).toContain(pageFetchJob);
  });

  test("all entries have required fields", () => {
    for (const job of jobRegistry) {
      expect(job.name).toBeDefined();
      expect(typeof job.name).toBe("string");
      expect(job.queue).toBeDefined();
      expect(typeof job.queue).toBe("string");
      expect(job.handler).toBeDefined();
      expect(typeof job.handler).toBe("function");
      expect(job.description).toBeDefined();
      expect(typeof job.description).toBe("string");
      expect(typeof job.requiresBrowser).toBe("boolean");
    }
  });

  test("job names are unique", () => {
    const names = jobRegistry.map((j) => `${j.queue}:${j.name}`);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ============================================================================
// Jobs By Queue Map Tests
// ============================================================================

describe("jobsByQueue", () => {
  test("is an object", () => {
    expect(typeof jobsByQueue).toBe("object");
  });

  test("has page-fetch queue entry", () => {
    expect(jobsByQueue[QUEUE_NAMES.PAGE_FETCH]).toBeDefined();
    expect(jobsByQueue["page-fetch"]).toBeDefined();
  });

  test("page-fetch queue has fetch handler", () => {
    const handlers = jobsByQueue[QUEUE_NAMES.PAGE_FETCH];
    expect(handlers.fetch).toBeDefined();
    expect(typeof handlers.fetch).toBe("function");
  });

  test("page-fetch queue handler matches pageFetchJob.handler", () => {
    expect(jobsByQueue[QUEUE_NAMES.PAGE_FETCH].fetch).toBe(pageFetchJob.handler);
  });

  test("only contains one queue", () => {
    const queueNames = Object.keys(jobsByQueue);
    expect(queueNames.length).toBe(1);
    expect(queueNames[0]).toBe(QUEUE_NAMES.PAGE_FETCH);
  });
});

// ============================================================================
// getJobHandler Utility Tests
// ============================================================================

describe("getJobHandler", () => {
  test("returns handler for valid queue and job name", () => {
    const handler = getJobHandler(QUEUE_NAMES.PAGE_FETCH, "fetch");
    expect(handler).toBeDefined();
    expect(handler).toBe(pageFetchJob.handler);
  });

  test("returns undefined for invalid queue", () => {
    const handler = getJobHandler("non-existent-queue", "fetch");
    expect(handler).toBeUndefined();
  });

  test("returns undefined for invalid job name", () => {
    const handler = getJobHandler(QUEUE_NAMES.PAGE_FETCH, "non-existent-job");
    expect(handler).toBeUndefined();
  });

  test("returns undefined for both invalid queue and job name", () => {
    const handler = getJobHandler("non-existent-queue", "non-existent-job");
    expect(handler).toBeUndefined();
  });
});

// ============================================================================
// getPageFetchHandler Utility Tests
// ============================================================================

describe("getPageFetchHandler", () => {
  test("returns the page fetch handler", () => {
    const handler = getPageFetchHandler();
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  test("returns the same handler as pageFetchJob.handler", () => {
    expect(getPageFetchHandler()).toBe(pageFetchJob.handler);
  });

  test("returns the same handler as getJobHandler lookup", () => {
    const handler = getJobHandler(QUEUE_NAMES.PAGE_FETCH, "fetch");
    expect(handler).toBeDefined();
    // Cast to avoid type narrowing issues
    expect(getPageFetchHandler()).toBe(handler as JobHandler);
  });
});

// ============================================================================
// getRegisteredJobNames Utility Tests
// ============================================================================

describe("getRegisteredJobNames", () => {
  test("returns an array", () => {
    const names = getRegisteredJobNames();
    expect(Array.isArray(names)).toBe(true);
  });

  test("returns correct number of job names", () => {
    const names = getRegisteredJobNames();
    expect(names.length).toBe(1);
  });

  test("returns job names in queue:name format", () => {
    const names = getRegisteredJobNames();
    expect(names[0]).toBe("page-fetch:fetch");
  });

  test("all names are unique", () => {
    const names = getRegisteredJobNames();
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ============================================================================
// getJobCount Utility Tests
// ============================================================================

describe("getJobCount", () => {
  test("returns correct count", () => {
    expect(getJobCount()).toBe(1);
  });

  test("matches registry length", () => {
    expect(getJobCount()).toBe(jobRegistry.length);
  });
});

// ============================================================================
// jobRequiresBrowser Utility Tests
// ============================================================================

describe("jobRequiresBrowser", () => {
  test("returns true for page-fetch:fetch", () => {
    expect(jobRequiresBrowser(QUEUE_NAMES.PAGE_FETCH, "fetch")).toBe(true);
  });

  test("returns false for non-existent job", () => {
    expect(jobRequiresBrowser("non-existent", "job")).toBe(false);
  });

  test("returns false for valid queue but invalid job name", () => {
    expect(jobRequiresBrowser(QUEUE_NAMES.PAGE_FETCH, "non-existent")).toBe(false);
  });
});

// ============================================================================
// getJobRegistration Utility Tests
// ============================================================================

describe("getJobRegistration", () => {
  test("returns registration for valid queue and job name", () => {
    const registration = getJobRegistration(QUEUE_NAMES.PAGE_FETCH, "fetch");
    expect(registration).toBeDefined();
    expect(registration).toBe(pageFetchJob);
  });

  test("returns undefined for invalid queue", () => {
    const registration = getJobRegistration("non-existent-queue", "fetch");
    expect(registration).toBeUndefined();
  });

  test("returns undefined for invalid job name", () => {
    const registration = getJobRegistration(QUEUE_NAMES.PAGE_FETCH, "non-existent-job");
    expect(registration).toBeUndefined();
  });

  test("returned registration has all required fields", () => {
    const registration = getJobRegistration(QUEUE_NAMES.PAGE_FETCH, "fetch");
    expect(registration).toBeDefined();
    expect(registration!.name).toBe("fetch");
    expect(registration!.queue).toBe(QUEUE_NAMES.PAGE_FETCH);
    expect(registration!.handler).toBeDefined();
    expect(registration!.description).toBeDefined();
    expect(registration!.requiresBrowser).toBe(true);
  });
});

// ============================================================================
// Type Export Tests
// ============================================================================

describe("Type Exports", () => {
  test("JobHandler type is usable", () => {
    // Type assertion test - this validates the type is exported correctly
    const typedHandler: JobHandler = pageFetchJob.handler;
    expect(typedHandler).toBeDefined();
  });

  test("PageFetchHandler type is usable", () => {
    // Type assertion test
    const typedHandler: PageFetchHandler = handlePageFetch;
    expect(typedHandler).toBeDefined();
  });

  test("JobRegistration type is usable", () => {
    // Type assertion test
    const registration: JobRegistration = pageFetchJob;
    expect(registration).toBeDefined();
  });
});

// ============================================================================
// Consistency Tests
// ============================================================================

describe("Registry Consistency", () => {
  test("all registry entries are accessible via getJobHandler", () => {
    for (const job of jobRegistry) {
      const handler = getJobHandler(job.queue, job.name);
      expect(handler).toBeDefined();
      expect(handler).toBe(job.handler);
    }
  });

  test("all registry entries are accessible via getJobRegistration", () => {
    for (const job of jobRegistry) {
      const registration = getJobRegistration(job.queue, job.name);
      expect(registration).toBeDefined();
      expect(registration).toBe(job);
    }
  });

  test("jobsByQueue contains all registry entries", () => {
    for (const job of jobRegistry) {
      expect(jobsByQueue[job.queue]).toBeDefined();
      expect(jobsByQueue[job.queue][job.name]).toBeDefined();
      expect(jobsByQueue[job.queue][job.name]).toBe(job.handler);
    }
  });

  test("getRegisteredJobNames matches registry", () => {
    const names = getRegisteredJobNames();
    const registryNames = jobRegistry.map((j) => `${j.queue}:${j.name}`);
    expect(names).toEqual(registryNames);
  });
});

// ============================================================================
// Integration with Entry Point Tests
// ============================================================================

describe("Entry Point Integration", () => {
  test("pageFetchJob.queue matches scraper worker queue", () => {
    // The scraper worker uses QUEUE_NAMES.PAGE_FETCH
    expect(pageFetchJob.queue).toBe(QUEUE_NAMES.PAGE_FETCH);
  });

  test("handler can be retrieved by the entry point pattern", () => {
    // The entry point uses getPageFetchHandler()
    const handler = getPageFetchHandler();
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  test("getJobCount provides startup logging info", () => {
    // The entry point logs registeredJobs: getJobCount()
    const count = getJobCount();
    expect(count).toBe(1);
    expect(count).toBeGreaterThan(0);
  });
});
