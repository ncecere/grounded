import { useState, useEffect } from "react";
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

  // Fetch retrieval config when editing
  const { data: fetchedRetrievalConfig } = useQuery({
    queryKey: ["retrieval-config", agent?.id],
    queryFn: () => api.getRetrievalConfig(agent!.id),
    enabled: isEditMode && open,
  });

  // Reset form when modal opens/closes or agent changes
  useEffect(() => {
    if (open) {
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
    if (!formData.name.trim() || formData.kbIds.length === 0) return;

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
                  <Label>Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Support Agent"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Helps users with product questions"
                  />
                </div>

                <div className="space-y-2">
                  <Label>System Prompt *</Label>
                  <Textarea
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                    rows={5}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Instructions that define how the agent behaves
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Welcome Message</Label>
                  <Input
                    value={formData.welcomeMessage}
                    onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                    placeholder="How can I help?"
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown in the widget empty state
                  </p>
                </div>

                {isEditMode && (
                  <div className="space-y-2">
                    <Label>Logo URL</Label>
                    <Input
                      type="url"
                      value={formData.logoUrl}
                      onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                      placeholder="https://example.com/logo.png"
                    />
                    <p className="text-xs text-muted-foreground">
                      Displayed in widget header (32x32px recommended)
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Model & Knowledge Tab */}
              <TabsContent value="knowledge" className="space-y-4 mt-0">
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
                  {formData.kbIds.length === 0 && (
                    <p className="text-xs text-destructive">
                      At least one knowledge base is required
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
              disabled={isPending || formData.kbIds.length === 0 || !formData.name.trim()}
            >
              {isPending ? "Saving..." : isEditMode ? "Save Changes" : "Create Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
