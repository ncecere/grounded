import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, Loader2, Database, FileText, Calendar } from "lucide-react";
import { api, type KnowledgeBase } from "../../lib/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

interface KBDetailPanelProps {
  kb: KnowledgeBase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCreateMode?: boolean;
}

export function KBDetailPanel({
  kb,
  open,
  onOpenChange,
  isCreateMode = false,
}: KBDetailPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState<string>("");
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const isEditMode = !!kb && !isCreateMode;

  // Fetch embedding models
  const { data: modelsData } = useQuery({
    queryKey: ["models", "embedding"],
    queryFn: async () => {
      const res = await api.listModels({ type: "embedding" });
      return res.models;
    },
    enabled: open,
  });
  const embeddingModels = modelsData || [];

  // Reset form when panel opens or KB changes
  useEffect(() => {
    if (open) {
      setShowReindexConfirm(false);
      setHasUnsavedChanges(false);
      if (kb) {
        setName(kb.name);
        setDescription(kb.description || "");
        setSelectedEmbeddingModelId(kb.embeddingModelId || "");
      } else {
        setName("");
        setDescription("");
        setSelectedEmbeddingModelId("");
      }
    }
  }, [open, kb]);

  // Get model info
  const currentModel = embeddingModels.find((m) => m.id === kb?.embeddingModelId);
  const selectedModel = embeddingModels.find((m) => m.id === selectedEmbeddingModelId);
  const modelChanged = isEditMode && selectedEmbeddingModelId !== (kb?.embeddingModelId || "");

  const isReindexing = kb?.reindexStatus === "pending" || kb?.reindexStatus === "in_progress";

  // Mutations
  const createMutation = useMutation({
    mutationFn: api.createKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      onOpenChange(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      api.updateKnowledgeBase(kb!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setHasUnsavedChanges(false);
      if (!modelChanged) {
        // Close only if not waiting for reindex confirmation
      }
    },
  });

  const reindexMutation = useMutation({
    mutationFn: (embeddingModelId: string) =>
      api.reindexKnowledgeBase(kb!.id, embeddingModelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setShowReindexConfirm(false);
      onOpenChange(false);
    },
  });

  const cancelReindexMutation = useMutation({
    mutationFn: () => api.cancelKbReindex(kb!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });

  const handleSave = () => {
    if (!name.trim()) return;

    if (isCreateMode) {
      createMutation.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        embeddingModelId: selectedEmbeddingModelId || undefined,
      });
    } else if (kb) {
      // Update name/description if changed
      const updates: { name?: string; description?: string } = {};
      if (name !== kb.name) updates.name = name.trim();
      if (description !== (kb.description || "")) updates.description = description.trim() || undefined;

      if (Object.keys(updates).length > 0) {
        updateMutation.mutate(updates);
      }

      // If model changed, show confirmation
      if (modelChanged && selectedEmbeddingModelId) {
        setShowReindexConfirm(true);
      } else if (Object.keys(updates).length === 0) {
        onOpenChange(false);
      }
    }
  };

  const handleReindexConfirm = () => {
    if (selectedEmbeddingModelId) {
      reindexMutation.mutate(selectedEmbeddingModelId);
    }
  };

  const handleFieldChange = () => {
    setHasUnsavedChanges(true);
  };

  const isPending = createMutation.isPending || updateMutation.isPending || reindexMutation.isPending;
  const error = createMutation.error || updateMutation.error || reindexMutation.error;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-lg">
            {isCreateMode ? "Create Knowledge Base" : kb?.name || "Knowledge Base"}
          </SheetTitle>
          {!isCreateMode && kb && (
            <SheetDescription className="text-sm flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                {kb.sourceCount ?? 0} sources
              </span>
              <span className="inline-flex items-center gap-1">
                <Database className="w-3.5 h-3.5" />
                {kb.chunkCount ?? 0} chunks
              </span>
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {showReindexConfirm ? (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <h3 className="font-medium text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Change Embedding Model
                </h3>
                <p className="text-sm text-muted-foreground">
                  You are changing the embedding model from{" "}
                  <strong>{currentModel?.displayName || "default"}</strong> to{" "}
                  <strong>{selectedModel?.displayName}</strong>.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  This will re-embed all {kb?.chunkCount || 0} chunks in the background. 
                  The knowledge base will remain usable during this process.
                </p>
              </div>

              {reindexMutation.error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{reindexMutation.error.message}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowReindexConfirm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReindexConfirm}
                  disabled={reindexMutation.isPending}
                  className="flex-1"
                >
                  {reindexMutation.isPending ? "Starting..." : "Start Reindex"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    handleFieldChange();
                  }}
                  placeholder="My Knowledge Base"
                  required
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    handleFieldChange();
                  }}
                  placeholder="Optional description..."
                  rows={3}
                />
              </div>

              {/* Embedding Model */}
              <div className="space-y-2">
                <Label>Embedding Model</Label>
                
                {isReindexing ? (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm">
                          Reindexing to {embeddingModels.find((m) => m.id === kb?.pendingEmbeddingModelId)?.displayName}...
                          {kb?.reindexProgress != null && ` (${kb.reindexProgress}%)`}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => cancelReindexMutation.mutate()}
                        disabled={cancelReindexMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : kb?.reindexStatus === "failed" ? (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg mb-2">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">Last reindex failed: {kb.reindexError}</span>
                    </div>
                  </div>
                ) : null}

                {!isReindexing && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {isCreateMode 
                        ? "Select which embedding model to use for this knowledge base"
                        : "Changing the embedding model will re-embed all content in the background."
                      }
                    </p>
                    <Select
                      value={selectedEmbeddingModelId || "default"}
                      onValueChange={(value) => {
                        setSelectedEmbeddingModelId(value === "default" ? "" : value);
                        handleFieldChange();
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Use default embedding model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          Use default model
                        </SelectItem>
                        {embeddingModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.displayName} ({model.dimensions}D)
                            {model.id === kb?.embeddingModelId && " - Current"}
                            {model.isDefault && " - Default"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>

              {/* KB Info - Edit mode only */}
              {isEditMode && kb && (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="text-sm font-medium mb-3">Knowledge Base Info</h4>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        Created
                      </dt>
                      <dd>{new Date(kb.createdAt).toLocaleDateString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        Sources
                      </dt>
                      <dd>{kb.sourceCount ?? 0}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5" />
                        Chunks
                      </dt>
                      <dd>{kb.chunkCount ?? 0}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">KB ID</dt>
                      <dd className="font-mono text-xs">{kb.id}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && !showReindexConfirm && (
          <div className="mx-6 mb-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}

        {/* Footer */}
        {!showReindexConfirm && (
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
                disabled={isPending || !name.trim() || isReindexing}
              >
                {isPending 
                  ? "Saving..." 
                  : isCreateMode 
                    ? "Create" 
                    : modelChanged 
                      ? "Save & Reindex" 
                      : "Save Changes"
                }
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
