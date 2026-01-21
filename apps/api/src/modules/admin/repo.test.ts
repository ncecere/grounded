import { describe, expect, it } from "bun:test";

import { fetchAuditActorsByIds, fetchAuditTenantsByIds } from "./repo";

describe("admin repo", () => {
  it("returns empty actors list without querying", async () => {
    const mockTx = {
      select: () => {
        throw new Error("should not be called");
      },
    };

    const result = await fetchAuditActorsByIds(mockTx as any, []);

    expect(result).toEqual([]);
  });

  it("returns empty tenants list without querying", async () => {
    const mockTx = {
      select: () => {
        throw new Error("should not be called");
      },
    };

    const result = await fetchAuditTenantsByIds(mockTx as any, []);

    expect(result).toEqual([]);
  });
});
