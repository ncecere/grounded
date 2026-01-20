import { Share2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import type { AgentFormData, RetrievalConfig, KnowledgeBase, LLMModel } from "../types";
import type { FormValidationErrors } from "../AgentFormModal";

interface ModelRagTabProps {
  formData: AgentFormData;
  onFormChange: (updates: Partial<AgentFormData>) => void;
  retrievalConfig: RetrievalConfig;
  onRetrievalChange: (updates: Partial<RetrievalConfig>) => void;
  knowledgeBases: KnowledgeBase[];
  llmModels: LLMModel[];
  validationErrors: FormValidationErrors;
  touched: Record<string, boolean>;
  markTouched: (field: string) => void;
  isEditMode: boolean;
}

export function ModelRagTab({
  formData,
  onFormChange,
  retrievalConfig,
  onRetrievalChange,
  knowledgeBases,
  llmModels,
  validationErrors,
  touched,
}: ModelRagTabProps) {
  const getFieldError = (field: keyof FormValidationErrors) => {
    return touched[field] ? validationErrors[field] : undefined;
  };

  const toggleKb = (kbId: string) => {
    const newKbIds = formData.kbIds.includes(kbId)
      ? formData.kbIds.filter((id) => id !== kbId)
      : [...formData.kbIds, kbId];
    onFormChange({ kbIds: newKbIds });
  };

  return (
    <div className="space-y-6">
      {/* RAG Mode */}
      <div className="space-y-2">
        <Label>RAG Mode</Label>
        <p className="text-xs text-muted-foreground">
          How the agent retrieves and processes knowledge
        </p>
        <Select
          value={formData.ragType}
          onValueChange={(value: "simple" | "advanced") =>
            onFormChange({ ragType: value })
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
          <>
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg mt-2">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Advanced mode rewrites queries with conversation context, generates sub-queries for comprehensive search, and shows reasoning steps during response generation.
              </p>
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded-lg mt-2">
              <div>
                <Label className="text-sm">Show Reasoning Steps</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Display the reasoning process in widget and published chat
                </p>
              </div>
              <Switch
                checked={formData.showReasoningSteps}
                onCheckedChange={(checked) =>
                  onFormChange({ showReasoningSteps: checked })
                }
              />
            </div>
          </>
        )}
      </div>

      {/* LLM Model */}
      <div className="space-y-2">
        <Label>LLM Model</Label>
        {llmModels.length > 0 ? (
          <Select
            value={formData.llmModelConfigId || "default"}
            onValueChange={(value) =>
              onFormChange({ llmModelConfigId: value === "default" ? "" : value })
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

      {/* Knowledge Bases */}
      <div className="space-y-2">
        <Label>Knowledge Bases *</Label>
        <p className="text-xs text-muted-foreground">
          Select which knowledge bases this agent can access
        </p>
        {knowledgeBases.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
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

      {/* Search Settings */}
      <div className="border-t pt-6">
        <h3 className="text-sm font-medium mb-4">Search Settings</h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Sources to Search</Label>
            <p className="text-xs text-muted-foreground">
              How many sources are searched initially (broader = more thorough but slower)
            </p>
            <Select
              value={String(retrievalConfig.candidateK)}
              onValueChange={(value) =>
                onRetrievalChange({ candidateK: parseInt(value) })
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
                onRetrievalChange({ topK: parseInt(value) })
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
                onRetrievalChange({ maxCitations: parseInt(value) })
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
                  onRetrievalChange({
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
        </div>
      </div>

      {/* Advanced Mode Settings */}
      {formData.ragType === "advanced" && (
        <div className="border-t pt-6">
          <h3 className="text-sm font-medium mb-4">Advanced Mode Settings</h3>
          <p className="text-xs text-muted-foreground mb-4">
            These settings only apply when Advanced RAG mode is enabled.
          </p>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>History Turns</Label>
              <p className="text-xs text-muted-foreground">
                Number of conversation turns used for query rewriting (1-20). Each turn = one user + assistant exchange.
              </p>
              <Select
                value={String(retrievalConfig.historyTurns)}
                onValueChange={(value) =>
                  onRetrievalChange({ historyTurns: parseInt(value) })
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
                  onRetrievalChange({ advancedMaxSubqueries: parseInt(value) })
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
          </div>
        </div>
      )}
    </div>
  );
}
