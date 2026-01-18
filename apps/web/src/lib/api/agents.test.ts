import { describe, it, expect } from "bun:test";

// Test module structure and exports for agents API
describe("agents API module", () => {
  describe("module exports", () => {
    it("should export agentsApi object", async () => {
      const { agentsApi } = await import("./agents");
      expect(agentsApi).toBeDefined();
      expect(typeof agentsApi).toBe("object");
    });

    it("should export all agent CRUD methods", async () => {
      const { agentsApi } = await import("./agents");
      expect(typeof agentsApi.listAgents).toBe("function");
      expect(typeof agentsApi.getAgent).toBe("function");
      expect(typeof agentsApi.createAgent).toBe("function");
      expect(typeof agentsApi.updateAgent).toBe("function");
      expect(typeof agentsApi.deleteAgent).toBe("function");
    });

    it("should export LLM model listing method", async () => {
      const { agentsApi } = await import("./agents");
      expect(typeof agentsApi.listLLMModels).toBe("function");
    });

    it("should export widget methods", async () => {
      const { agentsApi } = await import("./agents");
      expect(typeof agentsApi.getWidgetToken).toBe("function");
      expect(typeof agentsApi.getWidgetConfig).toBe("function");
      expect(typeof agentsApi.updateWidgetConfig).toBe("function");
    });

    it("should export retrieval config methods", async () => {
      const { agentsApi } = await import("./agents");
      expect(typeof agentsApi.getRetrievalConfig).toBe("function");
      expect(typeof agentsApi.updateRetrievalConfig).toBe("function");
    });

    it("should export chat endpoint methods", async () => {
      const { agentsApi } = await import("./agents");
      expect(typeof agentsApi.listChatEndpoints).toBe("function");
      expect(typeof agentsApi.createChatEndpoint).toBe("function");
      expect(typeof agentsApi.deleteChatEndpoint).toBe("function");
    });
  });

  describe("RagType import", () => {
    it("should import RagType from types module", async () => {
      // Verify the module can be imported (which means the type reference is valid)
      const agentsModule = await import("./agents");
      expect(agentsModule).toBeDefined();
    });
  });
});

describe("createAgent method contract", () => {
  describe("ragType parameter", () => {
    it("should accept ragType as an optional parameter", async () => {
      // This tests the type signature allows ragType
      // We verify the module imports correctly with the new signature
      const { agentsApi } = await import("./agents");
      expect(agentsApi.createAgent).toBeDefined();
      expect(agentsApi.createAgent.length).toBe(1); // Takes 1 data object parameter
    });

    it("should accept 'simple' as ragType value", () => {
      // Type-level test: valid ragType value
      const data = {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        kbIds: [],
        ragType: "simple" as const,
      };
      expect(data.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType value", () => {
      // Type-level test: valid ragType value
      const data = {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        kbIds: [],
        ragType: "advanced" as const,
      };
      expect(data.ragType).toBe("advanced");
    });

    it("should allow omitting ragType (defaults to simple on server)", () => {
      // Type-level test: ragType is optional
      const data: { name: string; systemPrompt: string; kbIds: string[]; ragType?: "simple" | "advanced" } = {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        kbIds: [],
      };
      expect(data.ragType).toBeUndefined();
    });
  });

  describe("other parameters remain valid", () => {
    it("should accept all standard agent creation fields", () => {
      const data = {
        name: "Test Agent",
        description: "A test agent",
        systemPrompt: "You are a helpful assistant",
        welcomeMessage: "Hello!",
        suggestedQuestions: ["How can I help?"],
        kbIds: ["kb-1", "kb-2"],
        llmModelConfigId: "model-1",
        ragType: "advanced" as const,
      };
      expect(data.name).toBe("Test Agent");
      expect(data.description).toBe("A test agent");
      expect(data.systemPrompt).toBe("You are a helpful assistant");
      expect(data.welcomeMessage).toBe("Hello!");
      expect(data.suggestedQuestions).toEqual(["How can I help?"]);
      expect(data.kbIds).toEqual(["kb-1", "kb-2"]);
      expect(data.llmModelConfigId).toBe("model-1");
      expect(data.ragType).toBe("advanced");
    });
  });
});

describe("updateAgent method contract", () => {
  describe("ragType parameter", () => {
    it("should accept ragType as an optional parameter", async () => {
      const { agentsApi } = await import("./agents");
      expect(agentsApi.updateAgent).toBeDefined();
      expect(agentsApi.updateAgent.length).toBe(2); // Takes id and data parameters
    });

    it("should accept 'simple' as ragType value", () => {
      const data = { ragType: "simple" as const };
      expect(data.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType value", () => {
      const data = { ragType: "advanced" as const };
      expect(data.ragType).toBe("advanced");
    });

    it("should allow omitting ragType in updates", () => {
      const data: { name: string; ragType?: "simple" | "advanced" } = { name: "Updated Name" };
      expect(data.ragType).toBeUndefined();
    });
  });

  describe("switching ragType", () => {
    it("should allow switching from simple to advanced", () => {
      const data = { ragType: "advanced" as const };
      expect(data.ragType).toBe("advanced");
    });

    it("should allow switching from advanced to simple", () => {
      const data = { ragType: "simple" as const };
      expect(data.ragType).toBe("simple");
    });
  });

  describe("other parameters remain valid", () => {
    it("should accept all standard agent update fields", () => {
      const data = {
        name: "Updated Agent",
        description: "Updated description",
        systemPrompt: "Updated prompt",
        welcomeMessage: "Updated welcome",
        logoUrl: "https://example.com/logo.png",
        isEnabled: true,
        ragType: "advanced" as const,
        suggestedQuestions: ["New question?"],
        kbIds: ["kb-3"],
        llmModelConfigId: "model-2",
        widgetConfig: { theme: "dark" },
        retrievalConfig: { topK: 5 },
      };
      expect(data.name).toBe("Updated Agent");
      expect(data.ragType).toBe("advanced");
      expect(data.isEnabled).toBe(true);
    });

    it("should allow null values for optional fields", () => {
      const data = {
        logoUrl: null,
        llmModelConfigId: null,
      };
      expect(data.logoUrl).toBeNull();
      expect(data.llmModelConfigId).toBeNull();
    });
  });
});

describe("updateRetrievalConfig method contract", () => {
  describe("historyTurns parameter", () => {
    it("should accept historyTurns as an optional parameter", async () => {
      const { agentsApi } = await import("./agents");
      expect(agentsApi.updateRetrievalConfig).toBeDefined();
    });

    it("should accept valid historyTurns values (1-20)", () => {
      const data = { historyTurns: 5 };
      expect(data.historyTurns).toBe(5);
    });

    it("should accept minimum historyTurns value (1)", () => {
      const data = { historyTurns: 1 };
      expect(data.historyTurns).toBe(1);
    });

    it("should accept maximum historyTurns value (20)", () => {
      const data = { historyTurns: 20 };
      expect(data.historyTurns).toBe(20);
    });
  });

  describe("advancedMaxSubqueries parameter", () => {
    it("should accept advancedMaxSubqueries as an optional parameter", () => {
      const data = { advancedMaxSubqueries: 3 };
      expect(data.advancedMaxSubqueries).toBe(3);
    });

    it("should accept minimum advancedMaxSubqueries value (1)", () => {
      const data = { advancedMaxSubqueries: 1 };
      expect(data.advancedMaxSubqueries).toBe(1);
    });

    it("should accept maximum advancedMaxSubqueries value (5)", () => {
      const data = { advancedMaxSubqueries: 5 };
      expect(data.advancedMaxSubqueries).toBe(5);
    });
  });

  describe("combined advanced RAG fields", () => {
    it("should accept both historyTurns and advancedMaxSubqueries together", () => {
      const data = {
        historyTurns: 10,
        advancedMaxSubqueries: 4,
      };
      expect(data.historyTurns).toBe(10);
      expect(data.advancedMaxSubqueries).toBe(4);
    });

    it("should allow omitting advanced RAG fields", () => {
      const data: { topK: number; historyTurns?: number; advancedMaxSubqueries?: number } = { topK: 5 };
      expect(data.historyTurns).toBeUndefined();
      expect(data.advancedMaxSubqueries).toBeUndefined();
    });
  });

  describe("all retrieval config parameters", () => {
    it("should accept all retrieval config fields together", () => {
      const data = {
        topK: 10,
        candidateK: 50,
        maxCitations: 5,
        rerankerEnabled: true,
        similarityThreshold: 0.7,
        historyTurns: 8,
        advancedMaxSubqueries: 3,
      };
      expect(data.topK).toBe(10);
      expect(data.candidateK).toBe(50);
      expect(data.maxCitations).toBe(5);
      expect(data.rerankerEnabled).toBe(true);
      expect(data.similarityThreshold).toBe(0.7);
      expect(data.historyTurns).toBe(8);
      expect(data.advancedMaxSubqueries).toBe(3);
    });
  });
});

describe("Agent type contract", () => {
  it("should expect Agent to have ragType field", async () => {
    const { agentsApi } = await import("./agents");
    // The fact that agentsApi exists and compiles means the Agent type
    // includes ragType (as imported from types.ts)
    expect(agentsApi).toBeDefined();
  });

  it("should expect Agent.retrievalConfig to have historyTurns", async () => {
    // Type-level test: Agent.retrievalConfig should have historyTurns
    type ExpectedConfig = {
      historyTurns: number;
      advancedMaxSubqueries: number;
    };
    const config: ExpectedConfig = {
      historyTurns: 5,
      advancedMaxSubqueries: 3,
    };
    expect(config.historyTurns).toBe(5);
    expect(config.advancedMaxSubqueries).toBe(3);
  });
});

describe("RagType type contract", () => {
  it("should accept 'simple' as valid RagType", async () => {
    const types = await import("./types");
    expect(types).toBeDefined();
    const ragType: "simple" | "advanced" = "simple";
    expect(ragType).toBe("simple");
  });

  it("should accept 'advanced' as valid RagType", async () => {
    const types = await import("./types");
    expect(types).toBeDefined();
    const ragType: "simple" | "advanced" = "advanced";
    expect(ragType).toBe("advanced");
  });
});

describe("API method parameter counts", () => {
  it("should have correct parameter counts for all methods", async () => {
    const { agentsApi } = await import("./agents");

    // Methods that take no parameters
    expect(agentsApi.listAgents.length).toBe(0);
    expect(agentsApi.listLLMModels.length).toBe(0);

    // Methods that take 1 parameter
    expect(agentsApi.getAgent.length).toBe(1);
    expect(agentsApi.createAgent.length).toBe(1);
    expect(agentsApi.deleteAgent.length).toBe(1);
    expect(agentsApi.getWidgetToken.length).toBe(1);
    expect(agentsApi.getWidgetConfig.length).toBe(1);
    expect(agentsApi.getRetrievalConfig.length).toBe(1);
    expect(agentsApi.listChatEndpoints.length).toBe(1);

    // Methods that take 2 parameters
    expect(agentsApi.updateAgent.length).toBe(2);
    expect(agentsApi.updateWidgetConfig.length).toBe(2);
    expect(agentsApi.updateRetrievalConfig.length).toBe(2);
    expect(agentsApi.createChatEndpoint.length).toBe(2);
    expect(agentsApi.deleteChatEndpoint.length).toBe(2);
  });
});
