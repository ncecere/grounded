import { describe, expect, it } from "bun:test";
import {
  DEFAULT_EMBED_JOB_ID_CONFIG,
  DeterministicEmbedJobIdConfig,
  DeterministicEmbedJobIdResult,
  generateDeterministicEmbedJobId,
  hashChunkIds,
  isValidDeterministicEmbedJobId,
  parseDeterministicEmbedJobId,
  wouldProduceSameEmbedJobId,
} from "./index";

// Test data
const KB_ID_1 = "550e8400-e29b-41d4-a716-446655440000";
const KB_ID_2 = "550e8400-e29b-41d4-a716-446655440001";

const CHUNK_ID_1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CHUNK_ID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const CHUNK_ID_3 = "c3d4e5f6-a7b8-9012-cdef-123456789012";

describe("Deterministic Embed Job IDs", () => {
  // ===========================================================================
  // DEFAULT_EMBED_JOB_ID_CONFIG
  // ===========================================================================
  describe("DEFAULT_EMBED_JOB_ID_CONFIG", () => {
    it("has correct default prefix", () => {
      expect(DEFAULT_EMBED_JOB_ID_CONFIG.prefix).toBe("embed");
    });

    it("has correct default hash length", () => {
      expect(DEFAULT_EMBED_JOB_ID_CONFIG.hashLength).toBe(16);
    });

    it("has includeKbId enabled by default", () => {
      expect(DEFAULT_EMBED_JOB_ID_CONFIG.includeKbId).toBe(true);
    });
  });

  // ===========================================================================
  // hashChunkIds
  // ===========================================================================
  describe("hashChunkIds", () => {
    it("produces consistent hash for same input", () => {
      const hash1 = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2]);
      const hash2 = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2]);
      expect(hash1).toBe(hash2);
    });

    it("produces same hash regardless of input order", () => {
      const hash1 = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3]);
      const hash2 = hashChunkIds([CHUNK_ID_3, CHUNK_ID_1, CHUNK_ID_2]);
      const hash3 = hashChunkIds([CHUNK_ID_2, CHUNK_ID_3, CHUNK_ID_1]);
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = hashChunkIds([CHUNK_ID_1]);
      const hash2 = hashChunkIds([CHUNK_ID_2]);
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for subsets vs supersets", () => {
      const hash1 = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2]);
      const hash2 = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3]);
      expect(hash1).not.toBe(hash2);
    });

    it("produces 16-character hex string", () => {
      const hash = hashChunkIds([CHUNK_ID_1]);
      expect(hash).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
    });

    it("handles single chunk ID", () => {
      const hash = hashChunkIds([CHUNK_ID_1]);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("handles many chunk IDs", () => {
      const manyChunks = Array.from({ length: 1000 }, (_, i) =>
        `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`
      );
      const hash = hashChunkIds(manyChunks);
      expect(hash).toHaveLength(16);
    });

    it("handles empty array gracefully", () => {
      const hash = hashChunkIds([]);
      expect(typeof hash).toBe("string");
    });
  });

  // ===========================================================================
  // generateDeterministicEmbedJobId
  // ===========================================================================
  describe("generateDeterministicEmbedJobId", () => {
    it("generates deterministic job ID for same inputs", () => {
      const result1 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2]);
      const result2 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2]);
      expect(result1.jobId).toBe(result2.jobId);
    });

    it("generates same job ID regardless of chunk order", () => {
      const result1 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2]);
      const result2 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_2, CHUNK_ID_1]);
      expect(result1.jobId).toBe(result2.jobId);
    });

    it("generates different job IDs for different KB IDs", () => {
      const result1 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);
      const result2 = generateDeterministicEmbedJobId(KB_ID_2, [CHUNK_ID_1]);
      expect(result1.jobId).not.toBe(result2.jobId);
    });

    it("generates different job IDs for different chunk sets", () => {
      const result1 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);
      const result2 = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_2]);
      expect(result1.jobId).not.toBe(result2.jobId);
    });

    it("returns sorted chunk IDs in result", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_3, CHUNK_ID_1, CHUNK_ID_2]);
      expect(result.sortedChunkIds).toEqual([CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3].sort());
    });

    it("returns correct chunk count", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3]);
      expect(result.chunkCount).toBe(3);
    });

    it("returns hash that matches hashChunkIds output", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2]);
      const expectedHash = hashChunkIds([CHUNK_ID_1, CHUNK_ID_2]);
      expect(result.hash).toBe(expectedHash.slice(0, 16));
    });

    it("throws error for empty chunk array", () => {
      expect(() => generateDeterministicEmbedJobId(KB_ID_1, [])).toThrow(
        "Cannot generate embed job ID: chunkIds array is empty"
      );
    });

    it("job ID format includes prefix, kbId, and hash", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);
      expect(result.jobId).toMatch(new RegExp(`^embed-${KB_ID_1}-[0-9a-f]+$`));
    });

    // Config tests
    describe("with custom config", () => {
      it("respects custom prefix", () => {
        const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
          prefix: "custom-embed",
        });
        expect(result.jobId.startsWith("custom-embed-")).toBe(true);
      });

      it("respects custom hash length", () => {
        const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
          hashLength: 8,
        });
        expect(result.hash).toHaveLength(8);
      });

      it("respects includeKbId=false", () => {
        const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
          includeKbId: false,
        });
        expect(result.jobId).toMatch(/^embed-[0-9a-f]+$/);
        expect(result.jobId).not.toContain(KB_ID_1);
      });

      it("caps hash length at 64", () => {
        const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
          hashLength: 100,
        });
        expect(result.hash.length).toBeLessThanOrEqual(64);
      });
    });
  });

  // ===========================================================================
  // isValidDeterministicEmbedJobId
  // ===========================================================================
  describe("isValidDeterministicEmbedJobId", () => {
    it("returns true for valid job ID with KB ID", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);
      expect(isValidDeterministicEmbedJobId(result.jobId)).toBe(true);
    });

    it("returns true for valid job ID without KB ID", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        includeKbId: false,
      });
      expect(isValidDeterministicEmbedJobId(result.jobId, { includeKbId: false })).toBe(true);
    });

    it("returns false for invalid format", () => {
      expect(isValidDeterministicEmbedJobId("invalid")).toBe(false);
      expect(isValidDeterministicEmbedJobId("embed-invalid")).toBe(false);
      expect(isValidDeterministicEmbedJobId("")).toBe(false);
    });

    it("validates hex-only hash portion", () => {
      // Valid hex hashes pass
      expect(isValidDeterministicEmbedJobId(`embed-${KB_ID_1}-abc123def456`)).toBe(true);

      // Hashes with non-hex characters fail
      expect(isValidDeterministicEmbedJobId(`embed-${KB_ID_1}-abc123xyz456`)).toBe(false);

      // Note: Old timestamp-based IDs like "1705596000000" are technically valid hex
      // (only contains digits 0-9), so they will pass validation. This is acceptable
      // since the validation is about format correctness, not semantic distinction.
    });

    it("validates with custom prefix", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        prefix: "custom",
      });
      expect(isValidDeterministicEmbedJobId(result.jobId, { prefix: "custom" })).toBe(true);
      expect(isValidDeterministicEmbedJobId(result.jobId, { prefix: "embed" })).toBe(false);
    });

    it("returns false for job ID missing hash", () => {
      expect(isValidDeterministicEmbedJobId(`embed-${KB_ID_1}`)).toBe(false);
    });

    it("returns false for job ID with non-hex hash", () => {
      expect(isValidDeterministicEmbedJobId(`embed-${KB_ID_1}-notahexvalue`)).toBe(false);
    });
  });

  // ===========================================================================
  // parseDeterministicEmbedJobId
  // ===========================================================================
  describe("parseDeterministicEmbedJobId", () => {
    it("parses valid job ID with KB ID", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);
      const parsed = parseDeterministicEmbedJobId(result.jobId);

      expect(parsed).not.toBeNull();
      expect(parsed!.kbId).toBe(KB_ID_1);
      expect(parsed!.hash).toBe(result.hash);
    });

    it("parses valid job ID without KB ID", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        includeKbId: false,
      });
      const parsed = parseDeterministicEmbedJobId(result.jobId, { includeKbId: false });

      expect(parsed).not.toBeNull();
      expect(parsed!.kbId).toBeNull();
      expect(parsed!.hash).toBe(result.hash);
    });

    it("returns null for invalid prefix", () => {
      const parsed = parseDeterministicEmbedJobId("notEmbed-something");
      expect(parsed).toBeNull();
    });

    it("returns null for malformed job ID", () => {
      expect(parseDeterministicEmbedJobId("embed-")).toBeNull();
      expect(parseDeterministicEmbedJobId("embed")).toBeNull();
      expect(parseDeterministicEmbedJobId("")).toBeNull();
    });

    it("returns null for invalid UUID in job ID", () => {
      const parsed = parseDeterministicEmbedJobId("embed-not-a-uuid-abc123");
      expect(parsed).toBeNull();
    });

    it("respects custom prefix when parsing", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        prefix: "myprefix",
      });
      const parsed = parseDeterministicEmbedJobId(result.jobId, { prefix: "myprefix" });
      expect(parsed).not.toBeNull();
      expect(parsed!.kbId).toBe(KB_ID_1);
    });

    it("extracts correct hash for various hash lengths", () => {
      const shortHash = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        hashLength: 8,
      });
      const parsed = parseDeterministicEmbedJobId(shortHash.jobId);
      expect(parsed).not.toBeNull();
      expect(parsed!.hash).toBe(shortHash.hash);
    });
  });

  // ===========================================================================
  // wouldProduceSameEmbedJobId
  // ===========================================================================
  describe("wouldProduceSameEmbedJobId", () => {
    it("returns true for identical arrays", () => {
      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_2],
        [CHUNK_ID_1, CHUNK_ID_2]
      )).toBe(true);
    });

    it("returns true for same elements in different order", () => {
      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3],
        [CHUNK_ID_3, CHUNK_ID_1, CHUNK_ID_2]
      )).toBe(true);
    });

    it("returns false for different lengths", () => {
      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_2],
        [CHUNK_ID_1]
      )).toBe(false);
    });

    it("returns false for different elements", () => {
      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_2],
        [CHUNK_ID_1, CHUNK_ID_3]
      )).toBe(false);
    });

    it("returns true for empty arrays", () => {
      expect(wouldProduceSameEmbedJobId([], [])).toBe(true);
    });

    it("returns false when one array is empty", () => {
      expect(wouldProduceSameEmbedJobId([CHUNK_ID_1], [])).toBe(false);
      expect(wouldProduceSameEmbedJobId([], [CHUNK_ID_1])).toBe(false);
    });

    it("handles duplicate IDs correctly", () => {
      // This tests the edge case of duplicate IDs in input
      // After sorting, they should still match
      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_1],
        [CHUNK_ID_1, CHUNK_ID_1]
      )).toBe(true);

      expect(wouldProduceSameEmbedJobId(
        [CHUNK_ID_1, CHUNK_ID_1],
        [CHUNK_ID_1]
      )).toBe(false);
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================
  describe("Integration", () => {
    it("round-trip: generate -> validate -> parse", () => {
      const original = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1, CHUNK_ID_2, CHUNK_ID_3]);

      // Validate
      expect(isValidDeterministicEmbedJobId(original.jobId)).toBe(true);

      // Parse
      const parsed = parseDeterministicEmbedJobId(original.jobId);
      expect(parsed).not.toBeNull();
      expect(parsed!.kbId).toBe(KB_ID_1);
      expect(parsed!.hash).toBe(original.hash);
    });

    it("idempotency: same input always produces same output", () => {
      const inputs = [CHUNK_ID_3, CHUNK_ID_1, CHUNK_ID_2];
      const results: DeterministicEmbedJobIdResult[] = [];

      // Generate 10 times
      for (let i = 0; i < 10; i++) {
        results.push(generateDeterministicEmbedJobId(KB_ID_1, inputs));
      }

      // All should be identical
      const firstJobId = results[0].jobId;
      expect(results.every(r => r.jobId === firstJobId)).toBe(true);
    });

    it("consistency check: wouldProduceSameEmbedJobId matches actual generation", () => {
      const chunks1 = [CHUNK_ID_1, CHUNK_ID_2];
      const chunks2 = [CHUNK_ID_2, CHUNK_ID_1];
      const chunks3 = [CHUNK_ID_1, CHUNK_ID_3];

      const result1 = generateDeterministicEmbedJobId(KB_ID_1, chunks1);
      const result2 = generateDeterministicEmbedJobId(KB_ID_1, chunks2);
      const result3 = generateDeterministicEmbedJobId(KB_ID_1, chunks3);

      // wouldProduceSame should predict equality
      expect(wouldProduceSameEmbedJobId(chunks1, chunks2)).toBe(true);
      expect(result1.jobId).toBe(result2.jobId);

      expect(wouldProduceSameEmbedJobId(chunks1, chunks3)).toBe(false);
      expect(result1.jobId).not.toBe(result3.jobId);
    });

    it("handles realistic batch sizes", () => {
      // Simulate typical batch sizes
      const batchSizes = [1, 10, 50, 100, 500];

      for (const size of batchSizes) {
        const chunks = Array.from({ length: size }, (_, i) =>
          `${i.toString(16).padStart(8, "0")}-aaaa-bbbb-cccc-${i.toString(16).padStart(12, "0")}`
        );

        const result = generateDeterministicEmbedJobId(KB_ID_1, chunks);
        expect(result.chunkCount).toBe(size);
        expect(isValidDeterministicEmbedJobId(result.jobId)).toBe(true);
      }
    });

    it("job IDs are BullMQ-compatible (no special characters)", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);

      // BullMQ job IDs should be safe for Redis keys
      // Should not contain: spaces, newlines, special chars
      expect(result.jobId).toMatch(/^[a-zA-Z0-9-]+$/);
    });

    it("different configurations produce different results as expected", () => {
      const defaultResult = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1]);

      const noKbResult = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        includeKbId: false,
      });

      const customPrefixResult = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        prefix: "custom",
      });

      // All should have different job IDs
      expect(defaultResult.jobId).not.toBe(noKbResult.jobId);
      expect(defaultResult.jobId).not.toBe(customPrefixResult.jobId);

      // But same hash (since same chunk IDs)
      expect(defaultResult.hash).toBe(noKbResult.hash);
      expect(defaultResult.hash).toBe(customPrefixResult.hash);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe("Edge Cases", () => {
    it("handles UUIDs with uppercase letters", () => {
      const upperCaseChunk = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
      const lowerCaseChunk = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const result1 = generateDeterministicEmbedJobId(KB_ID_1, [upperCaseChunk]);
      const result2 = generateDeterministicEmbedJobId(KB_ID_1, [lowerCaseChunk]);

      // Different case should produce different hashes (preserves input fidelity)
      expect(result1.hash).not.toBe(result2.hash);
    });

    it("handles very long hash configuration", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        hashLength: 1000, // Unreasonably long
      });

      // Should cap at 64 (the max hex chars from a BigInt)
      expect(result.hash.length).toBeLessThanOrEqual(64);
    });

    it("handles minimum hash length", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        hashLength: 1,
      });
      expect(result.hash).toHaveLength(1);
    });

    it("handles zero hash length (edge case)", () => {
      const result = generateDeterministicEmbedJobId(KB_ID_1, [CHUNK_ID_1], {
        hashLength: 0,
      });
      expect(result.hash).toHaveLength(0);
    });
  });
});
