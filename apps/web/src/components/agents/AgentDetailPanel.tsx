import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Brain, Palette, Code, FlaskConical } from "lucide-react";
import { api, type Agent } from "../../lib/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Button } from "../ui/button";
import { GeneralTab } from "./tabs/GeneralTab";
import { ModelRagTab } from "./tabs/ModelRagTab";
import { WidgetTab } from "./tabs/WidgetTab";
import { ChatApiTab } from "./tabs/ChatApiTab";
import { TestSuitesTab } from "./tabs/TestSuitesTab";
import type { AgentFormData, RetrievalConfig, KnowledgeBase, LLMModel } from "./types";
import { defaultAgentForm, defaultRetrievalConfig } from "./types";
import { validateAgentForm, isFormValid } from "./AgentFormModal";

type PanelTab = "general" | "model" | "widget" | "chat" | "test-suites";

interface AgentDetailPanelProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBases: KnowledgeBase[];
  llmModels: LLMModel[];
  onOpenTestChat: (agentId: string) => void;
  isCreateMode?: boolean;
}

export function AgentDetailPanel({
  agent,
  open,
  onOpenChange,
  knowledgeBases,
  llmModels,
  onOpenTestChat,
  isCreateMode = false,
}: AgentDetailPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PanelTab>("general");
  const [formData, setFormData] = useState<AgentFormData>(defaultAgentForm);
  const [retrievalConfig, setRetrievalConfig] = useState<RetrievalConfig>(defaultRetrievalConfig);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const isEditMode = !!agent && !isCreateMode;

  // Fetch retrieval config when editing
  const { data: fetchedRetrievalConfig } = useQuery({
    queryKey: ["retrieval-config", agent?.id],
    queryFn: () => api.getRetrievalConfig(agent!.id),
    enabled: isEditMode && open,
  });

  // Reset form when panel opens/closes or agent changes
  useEffect(() => {
    if (open) {
      setTouched({});
      setHasUnsavedChanges(false);

      if (agent) {
        setFormData({
          name: agent.name,
          description: agent.description || "",
          systemPrompt: agent.systemPrompt,
          welcomeMessage: agent.welcomeMessage || "How can I help?",
          logoUrl: agent.logoUrl || "",
          kbIds: agent.kbIds,
          llmModelConfigId: agent.llmModelConfigId || "",
          ragType: agent.ragType || "simple",
          showReasoningSteps: agent.showReasoningSteps ?? true,
        });
      } else {
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
      setHasUnsavedChanges(false);
    },
  });

  const updateRetrievalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RetrievalConfig }) =>
      api.updateRetrievalConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["retrieval-config"] });
      if (isCreateMode) {
        onOpenChange(false);
      }
      setHasUnsavedChanges(false);
    },
  });

  // Mark field as touched
  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  // Handle form changes
  const handleFormChange = (updates: Partial<AgentFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  const handleRetrievalChange = (updates: Partial<RetrievalConfig>) => {
    setRetrievalConfig((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  // Validation
  const validationErrors = validateAgentForm(formData);
  const formIsValid = isFormValid(validationErrors);

  // Handle save
  const handleSave = async () => {
    setTouched({
      name: true,
      description: true,
      welcomeMessage: true,
      systemPrompt: true,
      logoUrl: true,
      kbIds: true,
    });

    if (!formIsValid) return;

    if (isEditMode && agent) {
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
          showReasoningSteps: formData.showReasoningSteps,
        },
      });

      updateRetrievalMutation.mutate({
        id: agent.id,
        data: retrievalConfig,
      });
    } else {
      createMutation.mutate({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        systemPrompt: formData.systemPrompt,
        welcomeMessage: formData.welcomeMessage || undefined,
        kbIds: formData.kbIds,
        llmModelConfigId: formData.llmModelConfigId || undefined,
        ragType: formData.ragType,
        showReasoningSteps: formData.showReasoningSteps,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || updateRetrievalMutation.isPending;
  const error = createMutation.error || updateMutation.error || updateRetrievalMutation.error;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            {agent?.logoUrl && (
              <img
                src={agent.logoUrl}
                alt=""
                className="w-10 h-10 rounded-lg object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div>
              <SheetTitle className="text-lg">
                {isCreateMode ? "Create Agent" : agent?.name || "Agent"}
              </SheetTitle>
              {!isCreateMode && agent && (
                <SheetDescription className="text-sm">
                  {agent.isEnabled !== false ? "Active" : "Disabled"} · {agent.kbIds.length} KB{agent.kbIds.length !== 1 ? "s" : ""}
                </SheetDescription>
              )}
            </div>
          </div>
        </SheetHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as PanelTab)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <TabsList className={`mx-6 mt-4 grid w-auto ${isCreateMode ? "grid-cols-2" : "grid-cols-5"}`}>
            <TabsTrigger value="general" className="gap-2">
              <Bot className="w-4 h-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger value="model" className="gap-2">
              <Brain className="w-4 h-4" />
              <span className="hidden sm:inline">Model & RAG</span>
            </TabsTrigger>
            {!isCreateMode && (
              <>
                <TabsTrigger value="widget" className="gap-2">
                  <Palette className="w-4 h-4" />
                  <span className="hidden sm:inline">Widget</span>
                </TabsTrigger>
                <TabsTrigger value="chat" className="gap-2">
                  <Code className="w-4 h-4" />
                  <span className="hidden sm:inline">Chat & API</span>
                </TabsTrigger>
                <TabsTrigger value="test-suites" className="gap-2">
                  <FlaskConical className="w-4 h-4" />
                  <span className="hidden sm:inline">Test Suites</span>
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="general" className="mt-0 h-full">
              <GeneralTab
                agent={agent}
                formData={formData}
                onFormChange={handleFormChange}
                validationErrors={validationErrors}
                touched={touched}
                markTouched={markTouched}
                isEditMode={isEditMode}
              />
            </TabsContent>

            <TabsContent value="model" className="mt-0 h-full">
              <ModelRagTab
                formData={formData}
                onFormChange={handleFormChange}
                retrievalConfig={retrievalConfig}
                onRetrievalChange={handleRetrievalChange}
                knowledgeBases={knowledgeBases}
                llmModels={llmModels}
                validationErrors={validationErrors}
                touched={touched}
                markTouched={markTouched}
                isEditMode={isEditMode}
              />
            </TabsContent>

            {!isCreateMode && agent && (
              <>
                <TabsContent value="widget" className="mt-0 h-full">
                  <WidgetTab agent={agent} />
                </TabsContent>

                <TabsContent value="chat" className="mt-0 h-full">
                  <ChatApiTab agent={agent} onOpenTestChat={onOpenTestChat} />
                </TabsContent>

                <TabsContent value="test-suites" className="mt-0 h-full">
                  <TestSuitesTab agentId={agent.id} agentName={agent.name} />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mb-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}

        {/* Footer with Save */}
        <div className="px-6 py-4 border-t bg-background flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {hasUnsavedChanges && !isPending && "Unsaved changes"}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isPending || !formIsValid}
            >
              {isPending ? "Saving..." : isCreateMode ? "Create Agent" : "Save Changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
