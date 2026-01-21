import { describe, expect, it } from "bun:test";
import { getChatAgentRagType } from "./service";

describe("getChatAgentRagType", () => {
  it("returns ragType when agent exists", async () => {
    const mockTx = {
      query: {
        agents: {
          findFirst: async () => ({ ragType: "advanced" }),
        },
      },
    };

    const ragType = await getChatAgentRagType(mockTx as any, {
      agentId: "agent-123",
      tenantId: "tenant-123",
    });

    expect(ragType).toBe("advanced");
  });

  it("returns null when agent is missing", async () => {
    const mockTx = {
      query: {
        agents: {
          findFirst: async () => null,
        },
      },
    };

    const ragType = await getChatAgentRagType(mockTx as any, {
      agentId: "agent-missing",
      tenantId: "tenant-123",
    });

    expect(ragType).toBeNull();
  });
});
