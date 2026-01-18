import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, Bot, Brain, Search, Settings2 } from "lucide-react";
import { api } from "../../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import type { Agent, AgentFormData, RetrievalConfig, KnowledgeBase, LLMModel } from "./types";
import { defaultAgentForm, defaultRetrievalConfig } from "./types";

// ============================================================================
// Form Validation Constants (aligned with API zod schemas)
// ============================================================================

export const VALIDATION_LIMITS = {
  name: { min: 1, max: 100 },
  description: { max: 500 },
  welcomeMessage: { max: 200 },
  systemPrompt: { max: 4000 },
  logoUrl: { max: 500 },
} as const;

// ============================================================================
// Form Validation Types and Functions
// ============================================================================

export interface FormValidationErrors {
  name?: string;
  description?: string;
  welcomeMessage?: string;
  systemPrompt?: string;
  logoUrl?: string;
  kbIds?: string;
}

export function validateAgentForm(formData: AgentFormData): FormValidationErrors {
  const errors: FormValidationErrors = {};

  // Name validation
  const trimmedName = formData.name.trim();
  if (trimmedName.length === 0) {
    errors.name = "Name is required";
  } else if (trimmedName.length > VALIDATION_LIMITS.name.max) {
    errors.name = `Name must be ${VALIDATION_LIMITS.name.max} characters or less`;
  }

  // Description validation
  if (formData.description && formData.description.length > VALIDATION_LIMITS.description.max) {
    errors.description = `Description must be ${VALIDATION_LIMITS.description.max} characters or less`;
  }

  // Welcome message validation
  if (formData.welcomeMessage && formData.welcomeMessage.length > VALIDATION_LIMITS.welcomeMessage.max) {
    errors.welcomeMessage = `Welcome message must be ${VALIDATION_LIMITS.welcomeMessage.max} characters or less`;
  }

  // System prompt validation
  if (formData.systemPrompt && formData.systemPrompt.length > VALIDATION_LIMITS.systemPrompt.max) {
    errors.systemPrompt = `System prompt must be ${VALIDATION_LIMITS.systemPrompt.max} characters or less`;
  }

  // Logo URL validation
  if (formData.logoUrl) {
    if (formData.logoUrl.length > VALIDATION_LIMITS.logoUrl.max) {
      errors.logoUrl = `Logo URL must be ${VALIDATION_LIMITS.logoUrl.max} characters or less`;
    } else {
      try {
        new URL(formData.logoUrl);
      } catch {
        errors.logoUrl = "Please enter a valid URL";
      }
    }
  }

  // Knowledge base validation
  if (formData.kbIds.length === 0) {
    errors.kbIds = "At least one knowledge base is required";
  }

  return errors;
}

export function isFormValid(errors: FormValidationErrors): boolean {
  return Object.keys(errors).length === 0;
}

type FormTab = "general" | "knowledge" | "search" | "status";

interface AgentFormModalProps {
  /** Agent to edit, or null for create mode */
  agent: Agent | null;
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal should close */
  onOpenChange: (open: boolean) => void;
  /** Available knowledge bases */
  knowledgeBases: KnowledgeBase[];
  /** Available LLM models */
  llmModels: LLMModel[];
}

export function AgentFormModal({
  agent,
  open,
  onOpenChange,
  knowledgeBases,
  llmModels,
}: AgentFormModalProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!agent;

  const [activeTab, setActiveTab] = useState<FormTab>("general");
  const [formData, setFormData] = useState<AgentFormData>(defaultAgentForm);
  const [retrievalConfig, setRetrievalConfig] = useState<RetrievalConfig>(defaultRetrievalConfig);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Compute validation errors based on current form data
  const validationErrors = useMemo(() => validateAgentForm(formData), [formData]);
  const formIsValid = useMemo(() => isFormValid(validationErrors), [validationErrors]);

  // Helper to mark a field as touched (for showing errors after blur)
  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  // Helper to get error message (only if field has been touched or form submitted)
  const getFieldError = (field: keyof FormValidationErrors) => {
    return touched[field] ? validationErrors[field] : undefined;
  };

  // Fetch retrieval config when editing
  const { data: fetchedRetrievalConfig } = useQuery({
    queryKey: ["retrieval-config", agent?.id],
    queryFn: () => api.getRetrievalConfig(agent!.id),
    enabled: isEditMode && open,
  });

  // Reset form when modal opens/closes or agent changes
  useEffect(() => {
    if (open) {
      // Reset touched state when modal opens
      setTouched({});

      if (agent) {
        // Edit mode - populate from agent
        setFormData({
          name: agent.name,
          description: agent.description || "",
          systemPrompt: agent.systemPrompt,
          welcomeMessage: agent.welcomeMessage || "How can I help?",
          logoUrl: agent.logoUrl || "",
          kbIds: agent.kbIds,
          llmModelConfigId: agent.llmModelConfigId || "",
          ragType: agent.ragType || "simple",
        });
      } else {
        // Create mode - use defaults
        setFormData(defaultAgentForm);
        setRetrievalConfig(defaultRetrievalConfig);
      }
      setActiveTab("general");
    }
  }, [open, agent]);

  // Update retrieval config when fetched
  useEffect(() => {
    if (fetchedRetrievalConfig) {
      setRetrievalConfig({
        candidateK: fetchedRetrievalConfig.candidateK || 40,
        topK: fetchedRetrievalConfig.topK || 8,
        maxCitations: fetchedRetrievalConfig.maxCitations || 3,
        similarityThreshold: fetchedRetrievalConfig.similarityThreshold ?? 0.5,
        historyTurns: fetchedRetrievalConfig.historyTurns ?? 5,
        advancedMaxSubqueries: fetchedRetrievalConfig.advancedMaxSubqueries ?? 3,
      });
    }
  }, [fetchedRetrievalConfig]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: api.createAgent,
    onSuccess: (newAgent) => {
      // Also save retrieval config for new agent
      updateRetrievalMutation.mutate({
        id: newAgent.id,
        data: retrievalConfig,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateAgent>[1] }) =>
      api.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const updateRetrievalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RetrievalConfig }) =>
      api.updateRetrievalConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["retrieval-config"] });
      onOpenChange(false);
    },
  });

  const toggleKb = (kbId: string) => {
    setFormData((prev) => ({
      ...prev,
      kbIds: prev.kbIds.includes(kbId)
        ? prev.kbIds.filter((id) => id !== kbId)
        : [...prev.kbIds, kbId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all fields as touched to show all validation errors
    setTouched({
      name: true,
      description: true,
      welcomeMessage: true,
      systemPrompt: true,
      logoUrl: true,
      kbIds: true,
    });

    // Check validation before submitting
    if (!formIsValid) return;

    if (isEditMode && agent) {
      // Update existing agent
      await updateMutation.mutateAsync({
        id: agent.id,
        data: {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage || undefined,
          logoUrl: formData.logoUrl.trim() || null,
          kbIds: formData.kbIds,
          llmModelConfigId: formData.llmModelConfigId || null,
          ragType: formData.ragType,
        },
      });

      // Update retrieval config
      updateRetrievalMutation.mutate({
        id: agent.id,
        data: retrievalConfig,
      });
    } else {
      // Create new agent
      createMutation.mutate({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        systemPrompt: formData.systemPrompt,
        welcomeMessage: formData.welcomeMessage || undefined,
        kbIds: formData.kbIds,
        llmModelConfigId: formData.llmModelConfigId || undefined,
        ragType: formData.ragType,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || updateRetrievalMutation.isPending;
  const error = createMutation.error || updateMutation.error || updateRetrievalMutation.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Agent" : "Create Agent"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as FormTab)}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <TabsList className="grid w-full" style={{ gridTemplateColumns: isEditMode ? "repeat(4, 1fr)" : "repeat(3, 1fr)" }}>
              <TabsTrigger value="general" className="gap-2">
                <Bot className="w-4 h-4" />
                General
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-2">
                <Brain className="w-4 h-4" />
                Model & KB
              </TabsTrigger>
              <TabsTrigger value="search" className="gap-2">
                <Search className="w-4 h-4" />
                Search
              </TabsTrigger>
              {isEditMode && (
                <TabsTrigger value="status" className="gap-2">
                  <Settings2 className="w-4 h-4" />
                  Status
                </TabsTrigger>
              )}
            </TabsList>

            <div className="flex-1 overflow-y-auto py-4">
              {/* General Tab */}
              <TabsContent value="general" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Name *</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.name.length}/{VALIDATION_LIMITS.name.max}
                    </span>
                  </div>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    onBlur={() => markTouched("name")}
                    placeholder="Support Agent"
                    maxLength={VALIDATION_LIMITS.name.max}
                    className={getFieldError("name") ? "border-destructive" : ""}
                  />
                  {getFieldError("name") && (
                    <p className="text-xs text-destructive">{getFieldError("name")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Description</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.description.length}/{VALIDATION_LIMITS.description.max}
                    </span>
                  </div>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    onBlur={() => markTouched("description")}
                    placeholder="Helps users with product questions"
                    maxLength={VALIDATION_LIMITS.description.max}
                    className={getFieldError("description") ? "border-destructive" : ""}
                  />
                  {getFieldError("description") && (
                    <p className="text-xs text-destructive">{getFieldError("description")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>System Prompt *</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.systemPrompt.length}/{VALIDATION_LIMITS.systemPrompt.max}
                    </span>
                  </div>
                  <Textarea
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                    onBlur={() => markTouched("systemPrompt")}
                    rows={5}
                    maxLength={VALIDATION_LIMITS.systemPrompt.max}
                    className={getFieldError("systemPrompt") ? "border-destructive" : ""}
                  />
                  <p className="text-xs text-muted-foreground">
                    Instructions that define how the agent behaves
                  </p>
                  {getFieldError("systemPrompt") && (
                    <p className="text-xs text-destructive">{getFieldError("systemPrompt")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Welcome Message</Label>
                    <span className="text-xs text-muted-foreground">
                      {formData.welcomeMessage.length}/{VALIDATION_LIMITS.welcomeMessage.max}
                    </span>
                  </div>
                  <Input
                    value={formData.welcomeMessage}
                    onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                    onBlur={() => markTouched("welcomeMessage")}
                    placeholder="How can I help?"
                    maxLength={VALIDATION_LIMITS.welcomeMessage.max}
                    className={getFieldError("welcomeMessage") ? "border-destructive" : ""}
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown in the widget empty state
                  </p>
                  {getFieldError("welcomeMessage") && (
                    <p className="text-xs text-destructive">{getFieldError("welcomeMessage")}</p>
                  )}
                </div>

                {isEditMode && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Logo URL</Label>
                      <span className="text-xs text-muted-foreground">
                        {formData.logoUrl.length}/{VALIDATION_LIMITS.logoUrl.max}
                      </span>
                    </div>
                    <Input
                      type="url"
                      value={formData.logoUrl}
                      onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                      onBlur={() => markTouched("logoUrl")}
                      placeholder="https://example.com/logo.png"
                      maxLength={VALIDATION_LIMITS.logoUrl.max}
                      className={getFieldError("logoUrl") ? "border-destructive" : ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      Displayed in widget header (32x32px recommended)
                    </p>
                    {getFieldError("logoUrl") && (
                      <p className="text-xs text-destructive">{getFieldError("logoUrl")}</p>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Model & Knowledge Tab */}
              <TabsContent value="knowledge" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <Label>RAG Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    How the agent retrieves and processes knowledge
                  </p>
                  <Select
                    value={formData.ragType}
                    onValueChange={(value: "simple" | "advanced") =>
                      setFormData({ ...formData, ragType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select RAG mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">
                        Simple - Fast, single-pass retrieval
                      </SelectItem>
                      <SelectItem value="advanced">
                        Advanced - Multi-step with reasoning
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {formData.ragType === "advanced" && (
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg mt-2">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Advanced mode rewrites queries with conversation context, generates sub-queries for comprehensive search, and shows reasoning steps during response generation.
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>LLM Model</Label>
                  {llmModels.length > 0 ? (
                    <Select
                      value={formData.llmModelConfigId || "default"}
                      onValueChange={(value) =>
                        setFormData({ ...formData, llmModelConfigId: value === "default" ? "" : value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select LLM model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Use default model</SelectItem>
                        {llmModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.displayName} ({model.providerName})
                            {model.isDefault && " - Default"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                      No LLM models configured. Add models in AI Models settings.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Knowledge Bases *</Label>
                  <p className="text-xs text-muted-foreground">
                    Select which knowledge bases this agent can access
                  </p>
                  {knowledgeBases.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto border border-border rounded-lg p-2">
                      {knowledgeBases.map((kb) => (
                        <label
                          key={kb.id}
                          className={`flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer ${
                            kb.isShared ? "bg-purple-500/10" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={formData.kbIds.includes(kb.id)}
                            onChange={() => toggleKb(kb.id)}
                            className="rounded border-input text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-foreground flex items-center gap-2">
                            {kb.name}
                            {kb.isShared && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded">
                                <Share2 className="w-3 h-3" />
                                Shared
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                      No knowledge bases available. Create one first.
                    </p>
                  )}
                  {getFieldError("kbIds") && (
                    <p className="text-xs text-destructive">
                      {getFieldError("kbIds")}
                    </p>
                  )}
                </div>
              </TabsContent>

              {/* Search & Citations Tab */}
              <TabsContent value="search" className="space-y-4 mt-0">
                <div className="p-3 bg-muted/50 rounded-lg mb-4">
                  <p className="text-sm text-muted-foreground">
                    These settings control how the agent searches and cites sources.
                    {!isEditMode && " You can adjust these after creating the agent."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Sources to Search</Label>
                  <p className="text-xs text-muted-foreground">
                    How many sources are searched initially (broader = more thorough but slower)
                  </p>
                  <Select
                    value={String(retrievalConfig.candidateK)}
                    onValueChange={(value) =>
                      setRetrievalConfig({ ...retrievalConfig, candidateK: parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20 (Fast)</SelectItem>
                      <SelectItem value="40">40 (Balanced)</SelectItem>
                      <SelectItem value="60">60 (Thorough)</SelectItem>
                      <SelectItem value="100">100 (Very Thorough)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Sources for AI Context</Label>
                  <p className="text-xs text-muted-foreground">
                    How many top sources the AI reads to form its answer
                  </p>
                  <Select
                    value={String(retrievalConfig.topK)}
                    onValueChange={(value) =>
                      setRetrievalConfig({ ...retrievalConfig, topK: parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 (Minimal)</SelectItem>
                      <SelectItem value="5">5 (Focused)</SelectItem>
                      <SelectItem value="8">8 (Balanced)</SelectItem>
                      <SelectItem value="12">12 (Comprehensive)</SelectItem>
                      <SelectItem value="20">20 (Extensive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Max Citations</Label>
                  <p className="text-xs text-muted-foreground">
                    Maximum number of source citations shown to the user
                  </p>
                  <Select
                    value={String(retrievalConfig.maxCitations)}
                    onValueChange={(value) =>
                      setRetrievalConfig({ ...retrievalConfig, maxCitations: parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="8">8</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Similarity Threshold</Label>
                  <p className="text-xs text-muted-foreground">
                    Minimum relevance score (0-1) for sources. Higher = stricter matching.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={retrievalConfig.similarityThreshold}
                      onChange={(e) =>
                        setRetrievalConfig({
                          ...retrievalConfig,
                          similarityThreshold: parseFloat(e.target.value),
                        })
                      }
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <span className="text-sm font-medium w-12 text-right">
                      {retrievalConfig.similarityThreshold.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Advanced Mode Settings - only shown when ragType is "advanced" */}
                {formData.ragType === "advanced" && (
                  <>
                    <div className="border-t pt-4 mt-4">
                      <h3 className="text-sm font-medium mb-3">Advanced Mode Settings</h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        These settings only apply when Advanced RAG mode is enabled.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>History Turns</Label>
                      <p className="text-xs text-muted-foreground">
                        Number of conversation turns used for query rewriting (1-20). Each turn = one user + assistant exchange.
                      </p>
                      <Select
                        value={String(retrievalConfig.historyTurns)}
                        onValueChange={(value) =>
                          setRetrievalConfig({ ...retrievalConfig, historyTurns: parseInt(value) })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 turn</SelectItem>
                          <SelectItem value="3">3 turns</SelectItem>
                          <SelectItem value="5">5 turns (default)</SelectItem>
                          <SelectItem value="10">10 turns</SelectItem>
                          <SelectItem value="15">15 turns</SelectItem>
                          <SelectItem value="20">20 turns</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Max Sub-queries</Label>
                      <p className="text-xs text-muted-foreground">
                        Maximum number of sub-queries generated for comprehensive search (1-5). More sub-queries = more thorough but slower.
                      </p>
                      <Select
                        value={String(retrievalConfig.advancedMaxSubqueries)}
                        onValueChange={(value) =>
                          setRetrievalConfig({ ...retrievalConfig, advancedMaxSubqueries: parseInt(value) })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 (minimal)</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3 (default)</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                          <SelectItem value="5">5 (thorough)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Status Tab (Edit only) */}
              {isEditMode && agent && (
                <TabsContent value="status" className="space-y-4 mt-0">
                  <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div>
                      <Label className="text-base">Agent Status</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Disabled agents cannot be used for chat
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${agent.isEnabled !== false ? "text-success" : "text-muted-foreground"}`}>
                        {agent.isEnabled !== false ? "Enabled" : "Disabled"}
                      </span>
                      <Switch
                        checked={agent.isEnabled !== false}
                        onCheckedChange={(checked) => {
                          updateMutation.mutate({
                            id: agent.id,
                            data: { isEnabled: checked },
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="text-sm font-medium mb-2">Agent Info</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Created</dt>
                        <dd>{new Date(agent.createdAt).toLocaleDateString()}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Knowledge Bases</dt>
                        <dd>{agent.kbIds.length}</dd>
                      </div>
                    </dl>
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg mb-4">
              <p className="text-sm text-destructive">{error.message}</p>
            </div>
          )}

          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !formIsValid}
            >
              {isPending ? "Saving..." : isEditMode ? "Save Changes" : "Create Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
