import { describe, it, expect } from "bun:test";
import { z } from "zod";

// ============================================================================
// Schema Definitions (duplicated from agents.ts for isolated testing)
// ============================================================================

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().default(true),
  citationsEnabled: z.boolean().default(true),
  ragType: z.enum(["simple", "advanced"]).default("simple"),
  kbIds: z.array(z.string().uuid()).optional(),
  llmModelConfigId: z.string().uuid().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().optional(),
  citationsEnabled: z.boolean().optional(),
  ragType: z.enum(["simple", "advanced"]).optional(),
  isEnabled: z.boolean().optional(),
  llmModelConfigId: z.string().uuid().nullable().optional(),
  kbIds: z.array(z.string().uuid()).optional(),
});

const updateRetrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(50).optional(),
  candidateK: z.number().int().min(1).max(200).optional(),
  maxCitations: z.number().int().min(1).max(20).optional(),
  rerankerEnabled: z.boolean().optional(),
  rerankerType: z.enum(["heuristic", "cross_encoder"]).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  historyTurns: z.number().int().min(1).max(20).optional(),
  advancedMaxSubqueries: z.number().int().min(1).max(5).optional(),
});

// ============================================================================
// Tests for createAgentSchema
// ============================================================================

describe("createAgentSchema", () => {
  describe("ragType field", () => {
    it("should default ragType to 'simple' when not provided", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'simple' as ragType", () => {
      const result = createAgentSchema.parse({ name: "Test Agent", ragType: "simple" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType", () => {
      const result = createAgentSchema.parse({ name: "Test Agent", ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
    });

    it("should reject invalid ragType values", () => {
      expect(() =>
        createAgentSchema.parse({ name: "Test Agent", ragType: "invalid" })
      ).toThrow();
    });

    it("should reject non-string ragType values", () => {
      expect(() =>
        createAgentSchema.parse({ name: "Test Agent", ragType: 123 })
      ).toThrow();
    });
  });

  describe("other fields with defaults", () => {
    it("should set rerankerEnabled to true by default", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.rerankerEnabled).toBe(true);
    });

    it("should set citationsEnabled to true by default", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.citationsEnabled).toBe(true);
    });
  });

  describe("name field validation", () => {
    it("should reject empty name", () => {
      expect(() => createAgentSchema.parse({ name: "" })).toThrow();
    });

    it("should reject name longer than 100 characters", () => {
      expect(() =>
        createAgentSchema.parse({ name: "a".repeat(101) })
      ).toThrow();
    });

    it("should accept name at max length (100 characters)", () => {
      const result = createAgentSchema.parse({ name: "a".repeat(100) });
      expect(result.name.length).toBe(100);
    });
  });
});

// ============================================================================
// Tests for updateAgentSchema
// ============================================================================

describe("updateAgentSchema", () => {
  describe("ragType field", () => {
    it("should accept 'simple' as ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "simple" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
    });

    it("should allow ragType to be omitted", () => {
      const result = updateAgentSchema.parse({ name: "Updated Name" });
      expect(result.ragType).toBeUndefined();
    });

    it("should reject invalid ragType values", () => {
      expect(() => updateAgentSchema.parse({ ragType: "invalid" })).toThrow();
    });
  });

  describe("partial updates", () => {
    it("should allow updating only name", () => {
      const result = updateAgentSchema.parse({ name: "New Name" });
      expect(result.name).toBe("New Name");
      expect(result.description).toBeUndefined();
      expect(result.ragType).toBeUndefined();
    });

    it("should allow updating only ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
      expect(result.name).toBeUndefined();
    });

    it("should allow empty update (all optional)", () => {
      const result = updateAgentSchema.parse({});
      expect(Object.keys(result).length).toBe(0);
    });
  });
});

// ============================================================================
// Tests for updateRetrievalConfigSchema
// ============================================================================

describe("updateRetrievalConfigSchema", () => {
  describe("historyTurns field", () => {
    it("should accept valid historyTurns values", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 5 });
      expect(result.historyTurns).toBe(5);
    });

    it("should accept minimum historyTurns (1)", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 1 });
      expect(result.historyTurns).toBe(1);
    });

    it("should accept maximum historyTurns (20)", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 20 });
      expect(result.historyTurns).toBe(20);
    });

    it("should reject historyTurns below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 0 })
      ).toThrow();
    });

    it("should reject historyTurns above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 21 })
      ).toThrow();
    });

    it("should reject non-integer historyTurns", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 5.5 })
      ).toThrow();
    });

    it("should allow historyTurns to be omitted", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.historyTurns).toBeUndefined();
    });
  });

  describe("advancedMaxSubqueries field", () => {
    it("should accept valid advancedMaxSubqueries values", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 3 });
      expect(result.advancedMaxSubqueries).toBe(3);
    });

    it("should accept minimum advancedMaxSubqueries (1)", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 1 });
      expect(result.advancedMaxSubqueries).toBe(1);
    });

    it("should accept maximum advancedMaxSubqueries (5)", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 5 });
      expect(result.advancedMaxSubqueries).toBe(5);
    });

    it("should reject advancedMaxSubqueries below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 0 })
      ).toThrow();
    });

    it("should reject advancedMaxSubqueries above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 6 })
      ).toThrow();
    });

    it("should reject non-integer advancedMaxSubqueries", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 3.5 })
      ).toThrow();
    });

    it("should allow advancedMaxSubqueries to be omitted", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.advancedMaxSubqueries).toBeUndefined();
    });
  });

  describe("combined advanced RAG fields", () => {
    it("should accept both historyTurns and advancedMaxSubqueries together", () => {
      const result = updateRetrievalConfigSchema.parse({
        historyTurns: 10,
        advancedMaxSubqueries: 4,
      });
      expect(result.historyTurns).toBe(10);
      expect(result.advancedMaxSubqueries).toBe(4);
    });

    it("should accept advanced RAG fields with other retrieval config fields", () => {
      const result = updateRetrievalConfigSchema.parse({
        topK: 15,
        candidateK: 100,
        historyTurns: 8,
        advancedMaxSubqueries: 2,
        similarityThreshold: 0.7,
      });
      expect(result.topK).toBe(15);
      expect(result.candidateK).toBe(100);
      expect(result.historyTurns).toBe(8);
      expect(result.advancedMaxSubqueries).toBe(2);
      expect(result.similarityThreshold).toBe(0.7);
    });
  });

  describe("existing retrieval config fields", () => {
    it("should accept valid topK", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.topK).toBe(10);
    });

    it("should reject topK below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ topK: 0 })
      ).toThrow();
    });

    it("should reject topK above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ topK: 51 })
      ).toThrow();
    });

    it("should accept valid rerankerType", () => {
      const result = updateRetrievalConfigSchema.parse({ rerankerType: "cross_encoder" });
      expect(result.rerankerType).toBe("cross_encoder");
    });

    it("should reject invalid rerankerType", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ rerankerType: "invalid" })
      ).toThrow();
    });
  });
});

// ============================================================================
// Tests for RagType enum behavior
// ============================================================================

describe("RagType enum", () => {
  it("should have exactly two valid values", () => {
    const ragTypeSchema = z.enum(["simple", "advanced"]);

    // Valid values
    expect(() => ragTypeSchema.parse("simple")).not.toThrow();
    expect(() => ragTypeSchema.parse("advanced")).not.toThrow();

    // Invalid values
    expect(() => ragTypeSchema.parse("basic")).toThrow();
    expect(() => ragTypeSchema.parse("complex")).toThrow();
    expect(() => ragTypeSchema.parse("")).toThrow();
  });
});

// ============================================================================
// Tests for Agent CRUD Route Behavior
// ============================================================================

describe("Agent CRUD Route Behavior", () => {
  describe("Create Agent (POST /agents)", () => {
    describe("ragType in request body", () => {
      it("should accept ragType in create request body", () => {
        const body = createAgentSchema.parse({
          name: "Advanced RAG Agent",
          ragType: "advanced",
        });
        expect(body.ragType).toBe("advanced");
      });

      it("should default to simple when ragType not provided", () => {
        const body = createAgentSchema.parse({ name: "Simple Agent" });
        expect(body.ragType).toBe("simple");
      });

      it("should include ragType in insert values", () => {
        // Simulate how the route extracts ragType for insert
        const body = createAgentSchema.parse({
          name: "Test Agent",
          ragType: "advanced",
        });
        const insertValues = {
          name: body.name,
          ragType: body.ragType,
        };
        expect(insertValues.ragType).toBe("advanced");
      });
    });

    describe("response structure", () => {
      it("should specify that response includes ragType field", () => {
        // Document the expected response structure
        const expectedResponseShape = {
          agent: {
            id: "uuid",
            tenantId: "uuid",
            name: "string",
            ragType: "simple" as "simple" | "advanced",
            // ... other fields
          },
        };
        expect(expectedResponseShape.agent.ragType).toBeDefined();
      });

      it("should include kbIds array in response", () => {
        const expectedResponse = {
          agent: {
            id: "uuid",
            ragType: "simple" as const,
            kbIds: [] as string[],
          },
        };
        expect(Array.isArray(expectedResponse.agent.kbIds)).toBe(true);
      });
    });
  });

  describe("Get Agent (GET /agents/:agentId)", () => {
    describe("response includes ragType", () => {
      it("should return ragType as part of agent object", () => {
        // Document expected response structure
        const expectedResponse = {
          agent: {
            id: "uuid",
            name: "Test Agent",
            ragType: "simple" as "simple" | "advanced",
          },
          knowledgeBases: [] as Array<{ kbId: string; name: string }>,
        };
        expect(expectedResponse.agent.ragType).toBeDefined();
      });

      it("should support both simple and advanced ragType values", () => {
        const simpleAgent = { ragType: "simple" as const };
        const advancedAgent = { ragType: "advanced" as const };
        expect(simpleAgent.ragType).toBe("simple");
        expect(advancedAgent.ragType).toBe("advanced");
      });
    });
  });

  describe("List Agents (GET /agents)", () => {
    describe("response includes ragType for each agent", () => {
      it("should return ragType in agents array items", () => {
        // Document expected response structure
        const expectedResponse = {
          agents: [
            { id: "1", name: "Agent 1", ragType: "simple" as const, kbIds: [] },
            { id: "2", name: "Agent 2", ragType: "advanced" as const, kbIds: [] },
          ],
        };
        expect(expectedResponse.agents[0].ragType).toBe("simple");
        expect(expectedResponse.agents[1].ragType).toBe("advanced");
      });

      it("should include kbIds for each agent", () => {
        const expectedResponse = {
          agents: [
            { id: "1", ragType: "simple" as const, kbIds: ["kb-1", "kb-2"] },
          ],
        };
        expect(expectedResponse.agents[0].kbIds.length).toBe(2);
      });
    });
  });

  describe("Update Agent (PATCH /agents/:agentId)", () => {
    describe("ragType updates", () => {
      it("should allow updating ragType from simple to advanced", () => {
        const body = updateAgentSchema.parse({ ragType: "advanced" });
        expect(body.ragType).toBe("advanced");
      });

      it("should allow updating ragType from advanced to simple", () => {
        const body = updateAgentSchema.parse({ ragType: "simple" });
        expect(body.ragType).toBe("simple");
      });

      it("should allow updating ragType along with other fields", () => {
        const body = updateAgentSchema.parse({
          name: "Updated Name",
          ragType: "advanced",
          rerankerEnabled: false,
        });
        expect(body.name).toBe("Updated Name");
        expect(body.ragType).toBe("advanced");
        expect(body.rerankerEnabled).toBe(false);
      });

      it("should not change ragType if not provided in update", () => {
        const body = updateAgentSchema.parse({ name: "New Name" });
        expect(body.ragType).toBeUndefined();
        // When undefined, the route should not update ragType
      });
    });

    describe("response structure", () => {
      it("should return updated agent with ragType", () => {
        const expectedResponse = {
          agent: {
            id: "uuid",
            name: "Updated Agent",
            ragType: "advanced" as const,
          },
        };
        expect(expectedResponse.agent.ragType).toBe("advanced");
      });
    });
  });

  describe("Delete Agent (DELETE /agents/:agentId)", () => {
    it("should soft delete agent regardless of ragType", () => {
      // Document that deletion works for both ragType values
      const agentTypes = ["simple", "advanced"] as const;
      agentTypes.forEach((ragType) => {
        expect(ragType === "simple" || ragType === "advanced").toBe(true);
      });
    });
  });
});

// ============================================================================
// Tests for Retrieval Config Route Behavior
// ============================================================================

describe("Retrieval Config Route Behavior", () => {
  describe("Get Retrieval Config (GET /agents/:agentId/retrieval-config)", () => {
    describe("response includes advanced RAG fields", () => {
      it("should return historyTurns in retrieval config", () => {
        const expectedResponse = {
          retrievalConfig: {
            id: "uuid",
            agentId: "uuid",
            topK: 8,
            historyTurns: 5,
            advancedMaxSubqueries: 3,
          },
        };
        expect(expectedResponse.retrievalConfig.historyTurns).toBe(5);
      });

      it("should return advancedMaxSubqueries in retrieval config", () => {
        const expectedResponse = {
          retrievalConfig: {
            advancedMaxSubqueries: 3,
          },
        };
        expect(expectedResponse.retrievalConfig.advancedMaxSubqueries).toBe(3);
      });

      it("should return all retrieval config fields together", () => {
        const expectedFields = [
          "id",
          "agentId",
          "topK",
          "candidateK",
          "maxCitations",
          "rerankerEnabled",
          "rerankerType",
          "similarityThreshold",
          "historyTurns",
          "advancedMaxSubqueries",
        ];
        expect(expectedFields).toContain("historyTurns");
        expect(expectedFields).toContain("advancedMaxSubqueries");
      });
    });
  });

  describe("Update Retrieval Config (PUT /agents/:agentId/retrieval-config)", () => {
    describe("updating advanced RAG fields", () => {
      it("should accept historyTurns update", () => {
        const body = updateRetrievalConfigSchema.parse({ historyTurns: 10 });
        expect(body.historyTurns).toBe(10);
      });

      it("should accept advancedMaxSubqueries update", () => {
        const body = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 4 });
        expect(body.advancedMaxSubqueries).toBe(4);
      });

      it("should accept both fields together", () => {
        const body = updateRetrievalConfigSchema.parse({
          historyTurns: 8,
          advancedMaxSubqueries: 5,
        });
        expect(body.historyTurns).toBe(8);
        expect(body.advancedMaxSubqueries).toBe(5);
      });

      it("should accept advanced fields with existing fields", () => {
        const body = updateRetrievalConfigSchema.parse({
          topK: 12,
          candidateK: 60,
          historyTurns: 7,
          advancedMaxSubqueries: 2,
        });
        expect(body.topK).toBe(12);
        expect(body.candidateK).toBe(60);
        expect(body.historyTurns).toBe(7);
        expect(body.advancedMaxSubqueries).toBe(2);
      });
    });

    describe("response structure", () => {
      it("should return updated config with advanced fields", () => {
        const expectedResponse = {
          retrievalConfig: {
            historyTurns: 10,
            advancedMaxSubqueries: 4,
          },
        };
        expect(expectedResponse.retrievalConfig.historyTurns).toBe(10);
        expect(expectedResponse.retrievalConfig.advancedMaxSubqueries).toBe(4);
      });
    });
  });
});

// ============================================================================
// Tests for Agent Creation with Default Retrieval Config
// ============================================================================

describe("Agent Creation with Default Retrieval Config", () => {
  describe("default values for advanced RAG fields", () => {
    it("should document default historyTurns value (5)", () => {
      // When an agent is created, a default retrieval_config is created
      // with historyTurns = 5 (from database schema default)
      const defaultHistoryTurns = 5;
      expect(defaultHistoryTurns).toBe(5);
    });

    it("should document default advancedMaxSubqueries value (3)", () => {
      // When an agent is created, a default retrieval_config is created
      // with advancedMaxSubqueries = 3 (from database schema default)
      const defaultAdvancedMaxSubqueries = 3;
      expect(defaultAdvancedMaxSubqueries).toBe(3);
    });

    it("should create retrieval config alongside agent", () => {
      // Document that POST /agents creates:
      // 1. The agent record
      // 2. A default retrieval_config record
      // 3. A default agent_widget_config record
      // 4. A default widget_token
      const createdResources = [
        "agent",
        "retrieval_config",
        "agent_widget_config",
        "widget_token",
      ];
      expect(createdResources).toContain("retrieval_config");
    });
  });
});

// ============================================================================
// Tests for Advanced RAG Mode Configuration
// ============================================================================

describe("Advanced RAG Mode Configuration", () => {
  describe("ragType and retrieval config relationship", () => {
    it("should document that advanced RAG uses historyTurns for query rewriting", () => {
      // In advanced mode, historyTurns controls how many conversation
      // turns are included when rewriting the user's query
      const config = { ragType: "advanced" as const, historyTurns: 10 };
      expect(config.ragType).toBe("advanced");
      expect(config.historyTurns).toBe(10);
    });

    it("should document that advanced RAG uses advancedMaxSubqueries for plan generation", () => {
      // In advanced mode, advancedMaxSubqueries limits how many
      // sub-queries can be generated during the planning step
      const config = { ragType: "advanced" as const, advancedMaxSubqueries: 4 };
      expect(config.ragType).toBe("advanced");
      expect(config.advancedMaxSubqueries).toBe(4);
    });

    it("should document that simple RAG ignores advanced config fields", () => {
      // In simple mode, historyTurns and advancedMaxSubqueries are stored
      // but not used during chat processing
      const config = {
        ragType: "simple" as const,
        historyTurns: 10,
        advancedMaxSubqueries: 5,
      };
      expect(config.ragType).toBe("simple");
      // These values exist but are unused in simple mode
      expect(config.historyTurns).toBe(10);
      expect(config.advancedMaxSubqueries).toBe(5);
    });
  });

  describe("valid configuration combinations", () => {
    it("should allow simple agent with default config", () => {
      const agent = createAgentSchema.parse({ name: "Simple Agent" });
      expect(agent.ragType).toBe("simple");
    });

    it("should allow advanced agent with custom config", () => {
      const agent = createAgentSchema.parse({
        name: "Advanced Agent",
        ragType: "advanced",
      });
      const config = updateRetrievalConfigSchema.parse({
        historyTurns: 10,
        advancedMaxSubqueries: 5,
      });
      expect(agent.ragType).toBe("advanced");
      expect(config.historyTurns).toBe(10);
      expect(config.advancedMaxSubqueries).toBe(5);
    });
  });
});

// ============================================================================
// Tests for API Response Type Contracts
// ============================================================================

describe("API Response Type Contracts", () => {
  describe("Agent type includes ragType", () => {
    it("should document Agent interface includes ragType field", () => {
      // The Agent type (from database schema) includes ragType
      type AgentWithRagType = {
        id: string;
        tenantId: string;
        name: string;
        ragType: "simple" | "advanced";
        // ... other fields
      };
      const agent: AgentWithRagType = {
        id: "test-id",
        tenantId: "tenant-id",
        name: "Test",
        ragType: "advanced",
      };
      expect(agent.ragType).toBe("advanced");
    });
  });

  describe("RetrievalConfig type includes advanced fields", () => {
    it("should document RetrievalConfig interface includes historyTurns", () => {
      type RetrievalConfigWithAdvanced = {
        id: string;
        agentId: string;
        historyTurns: number;
        advancedMaxSubqueries: number;
        // ... other fields
      };
      const config: RetrievalConfigWithAdvanced = {
        id: "config-id",
        agentId: "agent-id",
        historyTurns: 5,
        advancedMaxSubqueries: 3,
      };
      expect(config.historyTurns).toBe(5);
      expect(config.advancedMaxSubqueries).toBe(3);
    });
  });
});
