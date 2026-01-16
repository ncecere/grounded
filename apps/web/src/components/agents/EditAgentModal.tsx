import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
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

interface EditAgentModalProps {
  agent: Agent | null;
  onClose: () => void;
  knowledgeBases: KnowledgeBase[];
  llmModels: LLMModel[];
}

export function EditAgentModal({
  agent,
  onClose,
  knowledgeBases,
  llmModels,
}: EditAgentModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<AgentFormData>(defaultAgentForm);
  const [retrievalConfig, setRetrievalConfig] = useState<RetrievalConfig>(defaultRetrievalConfig);
  const [searchSettingsOpen, setSearchSettingsOpen] = useState(false);

  // Fetch retrieval config when editing an agent
  const { data: fetchedRetrievalConfig } = useQuery({
    queryKey: ["retrieval-config", agent?.id],
    queryFn: () => api.getRetrievalConfig(agent!.id),
    enabled: !!agent,
  });

  // Populate edit form when agent is selected
  useEffect(() => {
    if (agent) {
      setFormData({
        name: agent.name,
        description: agent.description || "",
        systemPrompt: agent.systemPrompt,
        welcomeMessage: agent.welcomeMessage || "How can I help?",
        logoUrl: agent.logoUrl || "",
        kbIds: agent.kbIds,
        llmModelConfigId: agent.llmModelConfigId || "",
      });
    }
  }, [agent]);

  // Update retrieval config state when fetched
  useEffect(() => {
    if (fetchedRetrievalConfig) {
      setRetrievalConfig({
        candidateK: fetchedRetrievalConfig.candidateK || 40,
        topK: fetchedRetrievalConfig.topK || 8,
        maxCitations: fetchedRetrievalConfig.maxCitations || 3,
        rerankerEnabled: fetchedRetrievalConfig.rerankerEnabled ?? true,
        similarityThreshold: fetchedRetrievalConfig.similarityThreshold ?? 0.5,
      });
    } else {
      setRetrievalConfig(defaultRetrievalConfig);
    }
  }, [fetchedRetrievalConfig]);

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
      queryClient.invalidateQueries({ queryKey: ["retrieval-config"] });
      onClose();
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
    if (!agent || !formData.name.trim() || formData.kbIds.length === 0) return;

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

    updateRetrievalMutation.mutate({
      id: agent.id,
      data: retrievalConfig,
    });
  };

  if (!agent) return null;

  return (
    <Dialog open={!!agent} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
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
            <Label>System Prompt</Label>
            <Textarea
              value={formData.systemPrompt}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              rows={4}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Welcome Message</Label>
            <Input
              value={formData.welcomeMessage}
              onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
              placeholder="How can I help?"
            />
            <p className="text-xs text-muted-foreground">Shown in the widget empty state</p>
          </div>

          <div className="space-y-2">
            <Label>Logo URL</Label>
            <Input
              type="url"
              value={formData.logoUrl}
              onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
              placeholder="https://example.com/logo.png"
            />
            <p className="text-xs text-muted-foreground">Displayed in widget header (32x32px)</p>
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
                      {model.isDefault && " ★"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No LLM models configured. Add models in AI Models settings.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Knowledge Bases</Label>
            {knowledgeBases.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
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
              <p className="text-sm text-muted-foreground">
                No knowledge bases available. Create one first.
              </p>
            )}
          </div>

          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between py-3 border-t border-border">
            <div>
              <Label>Agent Status</Label>
              <p className="text-xs text-muted-foreground">Disabled agents cannot be used for chat</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${agent.isEnabled !== false ? "text-success" : "text-muted-foreground"}`}>
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

          {/* Search & Citation Settings - Collapsible */}
          <Collapsible open={searchSettingsOpen} onOpenChange={setSearchSettingsOpen}>
            <div className="pt-4 border-t border-border">
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left">
                <h3 className="text-sm font-medium text-foreground">Search & Citation Settings</h3>
                <ChevronDown
                  className={`w-5 h-5 text-muted-foreground transition-transform ${searchSettingsOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-4">
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
                  <Label>Sources to Cite</Label>
                  <p className="text-xs text-muted-foreground">
                    How many source citations are shown to the user
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

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">Smart Ranking</span>
                    <p className="text-xs text-muted-foreground">
                      Re-rank search results by relevance (recommended)
                    </p>
                  </div>
                  <Switch
                    checked={retrievalConfig.rerankerEnabled}
                    onCheckedChange={(checked) =>
                      setRetrievalConfig({ ...retrievalConfig, rerankerEnabled: checked })
                    }
                  />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                updateMutation.isPending ||
                updateRetrievalMutation.isPending ||
                formData.kbIds.length === 0
              }
            >
              {updateMutation.isPending || updateRetrievalMutation.isPending
                ? "Saving..."
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
