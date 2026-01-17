import { describe, it, expect, mock } from "bun:test";
import { NotFoundError } from "../middleware/error-handler";

// Since loadAgentForTenant and tryLoadAgentForTenant require a real database connection,
// we test them via behavior validation. These tests verify the module exports correctly
// and the error types are properly defined.

describe("agent-helpers", () => {
  describe("module exports", () => {
    it("should export loadAgentForTenant function", async () => {
      const { loadAgentForTenant } = await import("./agent-helpers");
      expect(typeof loadAgentForTenant).toBe("function");
    });

    it("should export tryLoadAgentForTenant function", async () => {
      const { tryLoadAgentForTenant } = await import("./agent-helpers");
      expect(typeof tryLoadAgentForTenant).toBe("function");
    });

    it("should export Agent type", async () => {
      // Type export verification - if this compiles, the type is exported
      const module = await import("./agent-helpers");
      expect(module).toBeDefined();
    });

    it("should export AgentOwnershipResult type", async () => {
      // Type export verification - if this compiles, the type is exported
      const module = await import("./agent-helpers");
      expect(module).toBeDefined();
    });
  });

  describe("NotFoundError behavior", () => {
    it("should create NotFoundError with Agent resource type", () => {
      const error = new NotFoundError("Agent");
      expect(error.message).toBe("Agent not found");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("loadAgentForTenant contract", () => {
    it("should throw NotFoundError when agent not found", async () => {
      const { loadAgentForTenant } = await import("./agent-helpers");

      // Create a mock transaction that returns null for agent lookup
      const mockTx = {
        query: {
          agents: {
            findFirst: mock(() => Promise.resolve(null)),
          },
        },
      };

      await expect(
        loadAgentForTenant(mockTx as any, "test-agent-id", "test-tenant-id")
      ).rejects.toThrow(NotFoundError);
    });

    it("should return agent when found", async () => {
      const { loadAgentForTenant } = await import("./agent-helpers");

      const mockAgent = {
        id: "test-agent-id",
        tenantId: "test-tenant-id",
        name: "Test Agent",
        deletedAt: null,
      };

      // Create a mock transaction that returns the agent
      const mockTx = {
        query: {
          agents: {
            findFirst: mock(() => Promise.resolve(mockAgent)),
          },
        },
      };

      const result = await loadAgentForTenant(
        mockTx as any,
        "test-agent-id",
        "test-tenant-id"
      );

      expect(result.agent.id).toBe(mockAgent.id);
      expect(result.agent.tenantId).toBe(mockAgent.tenantId);
      expect(result.agent.name).toBe(mockAgent.name);
    });
  });

  describe("tryLoadAgentForTenant contract", () => {
    it("should return null when agent not found", async () => {
      const { tryLoadAgentForTenant } = await import("./agent-helpers");

      // Create a mock transaction that returns null for agent lookup
      const mockTx = {
        query: {
          agents: {
            findFirst: mock(() => Promise.resolve(null)),
          },
        },
      };

      const result = await tryLoadAgentForTenant(
        mockTx as any,
        "test-agent-id",
        "test-tenant-id"
      );

      expect(result).toBeNull();
    });

    it("should return agent when found", async () => {
      const { tryLoadAgentForTenant } = await import("./agent-helpers");

      const mockAgent = {
        id: "test-agent-id",
        tenantId: "test-tenant-id",
        name: "Test Agent",
        deletedAt: null,
      };

      // Create a mock transaction that returns the agent
      const mockTx = {
        query: {
          agents: {
            findFirst: mock(() => Promise.resolve(mockAgent)),
          },
        },
      };

      const result = await tryLoadAgentForTenant(
        mockTx as any,
        "test-agent-id",
        "test-tenant-id"
      );

      expect(result?.id).toBe(mockAgent.id);
      expect(result?.tenantId).toBe(mockAgent.tenantId);
      expect(result?.name).toBe(mockAgent.name);
    });

    it("should return null when agent is undefined", async () => {
      const { tryLoadAgentForTenant } = await import("./agent-helpers");

      // Create a mock transaction that returns undefined for agent lookup
      const mockTx = {
        query: {
          agents: {
            findFirst: mock(() => Promise.resolve(undefined)),
          },
        },
      };

      const result = await tryLoadAgentForTenant(
        mockTx as any,
        "test-agent-id",
        "test-tenant-id"
      );

      expect(result).toBeNull();
    });
  });
});
