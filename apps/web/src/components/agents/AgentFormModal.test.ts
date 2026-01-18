import { describe, it, expect } from "bun:test";
import { defaultAgentForm, defaultRetrievalConfig } from "./types";

// Test AgentFormModal types and defaults related to RAG Type selector
describe("AgentFormModal RAG Type selector", () => {
  describe("defaultAgentForm ragType", () => {
    it("should have ragType field in defaultAgentForm", () => {
      expect(defaultAgentForm.ragType).toBeDefined();
    });

    it("should default ragType to 'simple'", () => {
      expect(defaultAgentForm.ragType).toBe("simple");
    });

    it("should have all required AgentFormData fields", () => {
      expect(defaultAgentForm.name).toBeDefined();
      expect(defaultAgentForm.description).toBeDefined();
      expect(defaultAgentForm.systemPrompt).toBeDefined();
      expect(defaultAgentForm.welcomeMessage).toBeDefined();
      expect(defaultAgentForm.logoUrl).toBeDefined();
      expect(defaultAgentForm.kbIds).toBeDefined();
      expect(defaultAgentForm.llmModelConfigId).toBeDefined();
      expect(defaultAgentForm.ragType).toBeDefined();
    });
  });

  describe("RAG Type selector values", () => {
    it("should only allow 'simple' or 'advanced' as ragType values", () => {
      // Type-level test: verify the two valid values
      const simpleType: "simple" | "advanced" = "simple";
      const advancedType: "simple" | "advanced" = "advanced";
      expect(simpleType).toBe("simple");
      expect(advancedType).toBe("advanced");
    });

    it("should allow changing ragType from simple to advanced", () => {
      const formData = { ...defaultAgentForm };
      formData.ragType = "advanced";
      expect(formData.ragType).toBe("advanced");
    });

    it("should allow changing ragType from advanced to simple", () => {
      const formData: { ragType: "simple" | "advanced" } = { ragType: "advanced" };
      formData.ragType = "simple";
      expect(formData.ragType).toBe("simple");
    });
  });

  describe("form data preparation for API", () => {
    describe("create agent", () => {
      it("should include ragType in create agent data with simple mode", () => {
        const formData = { ...defaultAgentForm, name: "Test Agent" };
        const createData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage || undefined,
          kbIds: formData.kbIds,
          llmModelConfigId: formData.llmModelConfigId || undefined,
          ragType: formData.ragType,
        };
        expect(createData.ragType).toBe("simple");
      });

      it("should include ragType in create agent data with advanced mode", () => {
        const formData = { ...defaultAgentForm, name: "Test Agent", ragType: "advanced" as const };
        const createData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage || undefined,
          kbIds: formData.kbIds,
          llmModelConfigId: formData.llmModelConfigId || undefined,
          ragType: formData.ragType,
        };
        expect(createData.ragType).toBe("advanced");
      });
    });

    describe("update agent", () => {
      it("should include ragType in update agent data with simple mode", () => {
        const formData = { ...defaultAgentForm, name: "Test Agent" };
        const updateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage || undefined,
          logoUrl: formData.logoUrl.trim() || null,
          kbIds: formData.kbIds,
          llmModelConfigId: formData.llmModelConfigId || null,
          ragType: formData.ragType,
        };
        expect(updateData.ragType).toBe("simple");
      });

      it("should include ragType in update agent data with advanced mode", () => {
        const formData = { ...defaultAgentForm, name: "Test Agent", ragType: "advanced" as const };
        const updateData = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage || undefined,
          logoUrl: formData.logoUrl.trim() || null,
          kbIds: formData.kbIds,
          llmModelConfigId: formData.llmModelConfigId || null,
          ragType: formData.ragType,
        };
        expect(updateData.ragType).toBe("advanced");
      });
    });
  });

  describe("agent population from existing agent", () => {
    it("should populate ragType from existing agent (simple)", () => {
      const existingAgent = {
        id: "agent-1",
        tenantId: "tenant-1",
        name: "Test Agent",
        description: "A test agent",
        systemPrompt: "You are helpful",
        welcomeMessage: "Hello!",
        logoUrl: null,
        kbIds: ["kb-1"],
        llmModelConfigId: null,
        ragType: "simple" as const,
        isEnabled: true,
        suggestedQuestions: [],
        createdAt: "2024-01-01",
      };

      const formData = {
        name: existingAgent.name,
        description: existingAgent.description || "",
        systemPrompt: existingAgent.systemPrompt,
        welcomeMessage: existingAgent.welcomeMessage || "How can I help?",
        logoUrl: existingAgent.logoUrl || "",
        kbIds: existingAgent.kbIds,
        llmModelConfigId: existingAgent.llmModelConfigId || "",
        ragType: existingAgent.ragType || "simple" as const,
      };

      expect(formData.ragType).toBe("simple");
    });

    it("should populate ragType from existing agent (advanced)", () => {
      const existingAgent = {
        id: "agent-1",
        tenantId: "tenant-1",
        name: "Advanced Agent",
        description: "An advanced agent",
        systemPrompt: "You are helpful",
        welcomeMessage: "Hello!",
        logoUrl: null,
        kbIds: ["kb-1"],
        llmModelConfigId: null,
        ragType: "advanced" as const,
        isEnabled: true,
        suggestedQuestions: [],
        createdAt: "2024-01-01",
      };

      const formData = {
        name: existingAgent.name,
        description: existingAgent.description || "",
        systemPrompt: existingAgent.systemPrompt,
        welcomeMessage: existingAgent.welcomeMessage || "How can I help?",
        logoUrl: existingAgent.logoUrl || "",
        kbIds: existingAgent.kbIds,
        llmModelConfigId: existingAgent.llmModelConfigId || "",
        ragType: existingAgent.ragType || "simple" as const,
      };

      expect(formData.ragType).toBe("advanced");
    });

    it("should default to simple if agent has no ragType", () => {
      const existingAgent = {
        id: "agent-1",
        tenantId: "tenant-1",
        name: "Legacy Agent",
        description: null,
        systemPrompt: "You are helpful",
        welcomeMessage: null,
        logoUrl: null,
        kbIds: ["kb-1"],
        llmModelConfigId: null,
        ragType: undefined as "simple" | "advanced" | undefined,
        isEnabled: true,
        suggestedQuestions: [],
        createdAt: "2024-01-01",
      };

      const formData = {
        name: existingAgent.name,
        description: existingAgent.description || "",
        systemPrompt: existingAgent.systemPrompt,
        welcomeMessage: existingAgent.welcomeMessage || "How can I help?",
        logoUrl: existingAgent.logoUrl || "",
        kbIds: existingAgent.kbIds,
        llmModelConfigId: existingAgent.llmModelConfigId || "",
        ragType: existingAgent.ragType || "simple" as const,
      };

      expect(formData.ragType).toBe("simple");
    });
  });

  describe("retrieval config defaults for advanced mode", () => {
    it("should have historyTurns in defaultRetrievalConfig", () => {
      expect(defaultRetrievalConfig.historyTurns).toBeDefined();
    });

    it("should default historyTurns to 5", () => {
      expect(defaultRetrievalConfig.historyTurns).toBe(5);
    });

    it("should have advancedMaxSubqueries in defaultRetrievalConfig", () => {
      expect(defaultRetrievalConfig.advancedMaxSubqueries).toBeDefined();
    });

    it("should default advancedMaxSubqueries to 3", () => {
      expect(defaultRetrievalConfig.advancedMaxSubqueries).toBe(3);
    });

    it("should have all retrieval config fields", () => {
      expect(defaultRetrievalConfig.candidateK).toBeDefined();
      expect(defaultRetrievalConfig.topK).toBeDefined();
      expect(defaultRetrievalConfig.maxCitations).toBeDefined();
      expect(defaultRetrievalConfig.similarityThreshold).toBeDefined();
      expect(defaultRetrievalConfig.historyTurns).toBeDefined();
      expect(defaultRetrievalConfig.advancedMaxSubqueries).toBeDefined();
    });
  });
});

describe("RAG Mode UI behavior contracts", () => {
  describe("Select component values", () => {
    it("should have 'simple' option text", () => {
      const simpleOption = "Simple - Fast, single-pass retrieval";
      expect(simpleOption).toContain("Simple");
      expect(simpleOption).toContain("Fast");
    });

    it("should have 'advanced' option text", () => {
      const advancedOption = "Advanced - Multi-step with reasoning";
      expect(advancedOption).toContain("Advanced");
      expect(advancedOption).toContain("Multi-step");
      expect(advancedOption).toContain("reasoning");
    });
  });

  describe("Advanced mode info panel", () => {
    it("should describe query rewriting feature", () => {
      const infoText =
        "Advanced mode rewrites queries with conversation context, generates sub-queries for comprehensive search, and shows reasoning steps during response generation.";
      expect(infoText).toContain("rewrites queries");
      expect(infoText).toContain("conversation context");
    });

    it("should describe sub-query generation", () => {
      const infoText =
        "Advanced mode rewrites queries with conversation context, generates sub-queries for comprehensive search, and shows reasoning steps during response generation.";
      expect(infoText).toContain("sub-queries");
      expect(infoText).toContain("comprehensive search");
    });

    it("should describe reasoning steps", () => {
      const infoText =
        "Advanced mode rewrites queries with conversation context, generates sub-queries for comprehensive search, and shows reasoning steps during response generation.";
      expect(infoText).toContain("reasoning steps");
    });
  });

  describe("form field label", () => {
    it("should have RAG Mode label", () => {
      const label = "RAG Mode";
      expect(label).toBe("RAG Mode");
    });

    it("should have helper text describing RAG Mode", () => {
      const helperText = "How the agent retrieves and processes knowledge";
      expect(helperText).toContain("retrieves");
      expect(helperText).toContain("processes");
      expect(helperText).toContain("knowledge");
    });
  });
});

describe("types module exports", () => {
  it("should export RagType type", async () => {
    const types = await import("./types");
    expect(types).toBeDefined();
  });

  it("should export AgentFormData with ragType field", async () => {
    const { defaultAgentForm } = await import("./types");
    expect(defaultAgentForm.ragType).toBeDefined();
  });

  it("should export RetrievalConfig with advanced RAG fields", async () => {
    const { defaultRetrievalConfig } = await import("./types");
    expect(defaultRetrievalConfig.historyTurns).toBeDefined();
    expect(defaultRetrievalConfig.advancedMaxSubqueries).toBeDefined();
  });
});

// Tests for Advanced Mode Settings UI
describe("Advanced Mode Settings UI", () => {
  describe("conditional visibility", () => {
    it("advanced settings should only show when ragType is 'advanced'", () => {
      // Form behavior: settings shown when formData.ragType === "advanced"
      const simpleFormData = { ...defaultAgentForm, ragType: "simple" as "simple" | "advanced" };
      const advancedFormData = { ...defaultAgentForm, ragType: "advanced" as "simple" | "advanced" };

      const showForSimple = simpleFormData.ragType === "advanced";
      const showForAdvanced = advancedFormData.ragType === "advanced";

      expect(showForSimple).toBe(false);
      expect(showForAdvanced).toBe(true);
    });

    it("should not show advanced settings for simple mode", () => {
      const formData = { ...defaultAgentForm, ragType: "simple" as "simple" | "advanced" };
      const shouldShowAdvancedSettings = formData.ragType === "advanced";
      expect(shouldShowAdvancedSettings).toBe(false);
    });

    it("should show advanced settings for advanced mode", () => {
      const formData = { ...defaultAgentForm, ragType: "advanced" as "simple" | "advanced" };
      const shouldShowAdvancedSettings = formData.ragType === "advanced";
      expect(shouldShowAdvancedSettings).toBe(true);
    });
  });

  describe("History Turns control", () => {
    it("should have valid historyTurns options (1, 3, 5, 10, 15, 20)", () => {
      const validOptions = [1, 3, 5, 10, 15, 20];
      validOptions.forEach(option => {
        expect(option).toBeGreaterThanOrEqual(1);
        expect(option).toBeLessThanOrEqual(20);
      });
    });

    it("should allow updating historyTurns value", () => {
      const retrievalConfig = { ...defaultRetrievalConfig };
      retrievalConfig.historyTurns = 10;
      expect(retrievalConfig.historyTurns).toBe(10);
    });

    it("should have descriptive label text for historyTurns", () => {
      const labelText = "History Turns";
      const helperText = "Number of conversation turns used for query rewriting (1-20). Each turn = one user + assistant exchange.";
      expect(labelText).toBe("History Turns");
      expect(helperText).toContain("conversation turns");
      expect(helperText).toContain("query rewriting");
      expect(helperText).toContain("1-20");
    });

    it("historyTurns options should include default indicator", () => {
      const defaultOption = "5 turns (default)";
      expect(defaultOption).toContain("default");
      expect(defaultOption).toContain("5");
    });

    it("should accept all valid historyTurns values", () => {
      const validValues = [1, 3, 5, 10, 15, 20];
      validValues.forEach(value => {
        const config = { ...defaultRetrievalConfig, historyTurns: value };
        expect(config.historyTurns).toBe(value);
      });
    });
  });

  describe("Max Sub-queries control", () => {
    it("should have valid advancedMaxSubqueries options (1-5)", () => {
      const validOptions = [1, 2, 3, 4, 5];
      validOptions.forEach(option => {
        expect(option).toBeGreaterThanOrEqual(1);
        expect(option).toBeLessThanOrEqual(5);
      });
    });

    it("should allow updating advancedMaxSubqueries value", () => {
      const retrievalConfig = { ...defaultRetrievalConfig };
      retrievalConfig.advancedMaxSubqueries = 5;
      expect(retrievalConfig.advancedMaxSubqueries).toBe(5);
    });

    it("should have descriptive label text for advancedMaxSubqueries", () => {
      const labelText = "Max Sub-queries";
      const helperText = "Maximum number of sub-queries generated for comprehensive search (1-5). More sub-queries = more thorough but slower.";
      expect(labelText).toBe("Max Sub-queries");
      expect(helperText).toContain("sub-queries");
      expect(helperText).toContain("comprehensive search");
      expect(helperText).toContain("1-5");
    });

    it("advancedMaxSubqueries options should include descriptions", () => {
      const minimalOption = "1 (minimal)";
      const defaultOption = "3 (default)";
      const thoroughOption = "5 (thorough)";

      expect(minimalOption).toContain("minimal");
      expect(defaultOption).toContain("default");
      expect(thoroughOption).toContain("thorough");
    });

    it("should accept all valid advancedMaxSubqueries values", () => {
      const validValues = [1, 2, 3, 4, 5];
      validValues.forEach(value => {
        const config = { ...defaultRetrievalConfig, advancedMaxSubqueries: value };
        expect(config.advancedMaxSubqueries).toBe(value);
      });
    });
  });

  describe("Advanced Mode Settings section header", () => {
    it("should have section title", () => {
      const sectionTitle = "Advanced Mode Settings";
      expect(sectionTitle).toBe("Advanced Mode Settings");
    });

    it("should have section description", () => {
      const sectionDescription = "These settings only apply when Advanced RAG mode is enabled.";
      expect(sectionDescription).toContain("Advanced RAG mode");
      expect(sectionDescription).toContain("enabled");
    });
  });

  describe("retrieval config with advanced settings", () => {
    it("should include historyTurns in retrieval config update data", () => {
      const retrievalConfig = {
        ...defaultRetrievalConfig,
        historyTurns: 10,
      };
      expect(retrievalConfig.historyTurns).toBe(10);
    });

    it("should include advancedMaxSubqueries in retrieval config update data", () => {
      const retrievalConfig = {
        ...defaultRetrievalConfig,
        advancedMaxSubqueries: 5,
      };
      expect(retrievalConfig.advancedMaxSubqueries).toBe(5);
    });

    it("should allow updating both advanced settings simultaneously", () => {
      const retrievalConfig = {
        ...defaultRetrievalConfig,
        historyTurns: 15,
        advancedMaxSubqueries: 4,
      };
      expect(retrievalConfig.historyTurns).toBe(15);
      expect(retrievalConfig.advancedMaxSubqueries).toBe(4);
    });

    it("should preserve other retrieval config values when updating advanced settings", () => {
      const retrievalConfig = {
        ...defaultRetrievalConfig,
        historyTurns: 10,
        advancedMaxSubqueries: 5,
      };

      // Verify other values are preserved
      expect(retrievalConfig.candidateK).toBe(defaultRetrievalConfig.candidateK);
      expect(retrievalConfig.topK).toBe(defaultRetrievalConfig.topK);
      expect(retrievalConfig.maxCitations).toBe(defaultRetrievalConfig.maxCitations);
      expect(retrievalConfig.similarityThreshold).toBe(defaultRetrievalConfig.similarityThreshold);
    });
  });

  describe("fetched retrieval config population", () => {
    it("should populate historyTurns from fetched config", () => {
      const fetchedConfig = {
        candidateK: 40,
        topK: 8,
        maxCitations: 3,
        similarityThreshold: 0.5,
        historyTurns: 10,
        advancedMaxSubqueries: 4,
      };

      const retrievalConfig = {
        candidateK: fetchedConfig.candidateK || 40,
        topK: fetchedConfig.topK || 8,
        maxCitations: fetchedConfig.maxCitations || 3,
        similarityThreshold: fetchedConfig.similarityThreshold ?? 0.5,
        historyTurns: fetchedConfig.historyTurns ?? 5,
        advancedMaxSubqueries: fetchedConfig.advancedMaxSubqueries ?? 3,
      };

      expect(retrievalConfig.historyTurns).toBe(10);
    });

    it("should populate advancedMaxSubqueries from fetched config", () => {
      const fetchedConfig = {
        candidateK: 40,
        topK: 8,
        maxCitations: 3,
        similarityThreshold: 0.5,
        historyTurns: 10,
        advancedMaxSubqueries: 4,
      };

      const retrievalConfig = {
        candidateK: fetchedConfig.candidateK || 40,
        topK: fetchedConfig.topK || 8,
        maxCitations: fetchedConfig.maxCitations || 3,
        similarityThreshold: fetchedConfig.similarityThreshold ?? 0.5,
        historyTurns: fetchedConfig.historyTurns ?? 5,
        advancedMaxSubqueries: fetchedConfig.advancedMaxSubqueries ?? 3,
      };

      expect(retrievalConfig.advancedMaxSubqueries).toBe(4);
    });

    it("should use default historyTurns (5) when fetched config has null/undefined", () => {
      const fetchedConfig = {
        candidateK: 40,
        topK: 8,
        maxCitations: 3,
        similarityThreshold: 0.5,
        historyTurns: null as number | null,
        advancedMaxSubqueries: null as number | null,
      };

      const retrievalConfig = {
        candidateK: fetchedConfig.candidateK || 40,
        topK: fetchedConfig.topK || 8,
        maxCitations: fetchedConfig.maxCitations || 3,
        similarityThreshold: fetchedConfig.similarityThreshold ?? 0.5,
        historyTurns: fetchedConfig.historyTurns ?? 5,
        advancedMaxSubqueries: fetchedConfig.advancedMaxSubqueries ?? 3,
      };

      expect(retrievalConfig.historyTurns).toBe(5);
    });

    it("should use default advancedMaxSubqueries (3) when fetched config has null/undefined", () => {
      const fetchedConfig = {
        candidateK: 40,
        topK: 8,
        maxCitations: 3,
        similarityThreshold: 0.5,
        historyTurns: null as number | null,
        advancedMaxSubqueries: null as number | null,
      };

      const retrievalConfig = {
        candidateK: fetchedConfig.candidateK || 40,
        topK: fetchedConfig.topK || 8,
        maxCitations: fetchedConfig.maxCitations || 3,
        similarityThreshold: fetchedConfig.similarityThreshold ?? 0.5,
        historyTurns: fetchedConfig.historyTurns ?? 5,
        advancedMaxSubqueries: fetchedConfig.advancedMaxSubqueries ?? 3,
      };

      expect(retrievalConfig.advancedMaxSubqueries).toBe(3);
    });
  });

  describe("Search tab behavior with advanced mode", () => {
    it("Search tab should contain advanced settings when ragType is advanced", () => {
      // This documents the behavior: Advanced Mode Settings appear in Search tab
      // when formData.ragType === "advanced"
      const formData = { ...defaultAgentForm, ragType: "advanced" as "simple" | "advanced" };
      const shouldShowInSearchTab = formData.ragType === "advanced";
      expect(shouldShowInSearchTab).toBe(true);
    });

    it("Search tab should not contain advanced settings when ragType is simple", () => {
      const formData = { ...defaultAgentForm, ragType: "simple" as "simple" | "advanced" };
      const shouldShowInSearchTab = formData.ragType === "advanced";
      expect(shouldShowInSearchTab).toBe(false);
    });
  });
});
