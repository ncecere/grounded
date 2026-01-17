import { describe, it, expect } from "bun:test";
import {
  getSourceCountsByKb,
  getChunkCountsByKb,
  getShareCountsByKb,
  getKbCountMaps,
  getKbCountMapsWithShares,
  getKbSourceCount,
  getKbChunkCount,
  getKbAggregatedCounts,
  type KbCountResult,
  type KbAggregatedCounts,
  type KbAggregatedCountsWithShares,
} from "./kb-aggregation-helpers";

describe("kb-aggregation-helpers", () => {
  describe("module exports", () => {
    it("should export getSourceCountsByKb function", () => {
      expect(typeof getSourceCountsByKb).toBe("function");
    });

    it("should export getChunkCountsByKb function", () => {
      expect(typeof getChunkCountsByKb).toBe("function");
    });

    it("should export getShareCountsByKb function", () => {
      expect(typeof getShareCountsByKb).toBe("function");
    });

    it("should export getKbCountMaps function", () => {
      expect(typeof getKbCountMaps).toBe("function");
    });

    it("should export getKbCountMapsWithShares function", () => {
      expect(typeof getKbCountMapsWithShares).toBe("function");
    });

    it("should export getKbSourceCount function", () => {
      expect(typeof getKbSourceCount).toBe("function");
    });

    it("should export getKbChunkCount function", () => {
      expect(typeof getKbChunkCount).toBe("function");
    });

    it("should export getKbAggregatedCounts function", () => {
      expect(typeof getKbAggregatedCounts).toBe("function");
    });
  });

  describe("type definitions", () => {
    it("should allow creating KbCountResult objects", () => {
      const result: KbCountResult = {
        kbId: "123e4567-e89b-12d3-a456-426614174000",
        count: 5,
      };
      expect(result.kbId).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(result.count).toBe(5);
    });

    it("should allow creating KbAggregatedCounts objects", () => {
      const counts: KbAggregatedCounts = {
        sourceCount: 10,
        chunkCount: 100,
      };
      expect(counts.sourceCount).toBe(10);
      expect(counts.chunkCount).toBe(100);
    });

    it("should allow creating KbAggregatedCountsWithShares objects", () => {
      const counts: KbAggregatedCountsWithShares = {
        sourceCount: 10,
        chunkCount: 100,
        shareCount: 3,
      };
      expect(counts.sourceCount).toBe(10);
      expect(counts.chunkCount).toBe(100);
      expect(counts.shareCount).toBe(3);
    });
  });

  describe("getSourceCountsByKb", () => {
    it("should return empty Map for empty kbIds array", async () => {
      // Create a mock tx that should never be called
      const mockTx = {
        select: () => {
          throw new Error("should not be called");
        },
      };

      const result = await getSourceCountsByKb(mockTx, []);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe("getChunkCountsByKb", () => {
    it("should return empty Map for empty kbIds array", async () => {
      // Create a mock tx that should never be called
      const mockTx = {
        select: () => {
          throw new Error("should not be called");
        },
      };

      const result = await getChunkCountsByKb(mockTx, []);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe("getShareCountsByKb", () => {
    it("should return empty Map for empty kbIds array", async () => {
      // Create a mock tx that should never be called
      const mockTx = {
        select: () => {
          throw new Error("should not be called");
        },
      };

      const result = await getShareCountsByKb(mockTx, []);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe("getKbCountMaps", () => {
    it("should return both empty Maps for empty kbIds array", async () => {
      // Create a mock tx that should never be called
      const mockTx = {
        select: () => {
          throw new Error("should not be called");
        },
      };

      const result = await getKbCountMaps(mockTx, []);
      expect(result.sourceCountMap).toBeInstanceOf(Map);
      expect(result.chunkCountMap).toBeInstanceOf(Map);
      expect(result.sourceCountMap.size).toBe(0);
      expect(result.chunkCountMap.size).toBe(0);
    });
  });

  describe("getKbCountMapsWithShares", () => {
    it("should return all three empty Maps for empty kbIds array", async () => {
      // Create a mock tx that should never be called
      const mockTx = {
        select: () => {
          throw new Error("should not be called");
        },
      };

      const result = await getKbCountMapsWithShares(mockTx, []);
      expect(result.sourceCountMap).toBeInstanceOf(Map);
      expect(result.chunkCountMap).toBeInstanceOf(Map);
      expect(result.shareCountMap).toBeInstanceOf(Map);
      expect(result.sourceCountMap.size).toBe(0);
      expect(result.chunkCountMap.size).toBe(0);
      expect(result.shareCountMap.size).toBe(0);
    });
  });
});
