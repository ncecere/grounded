import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type KnowledgeBase } from "../lib/api";
import { Share2, Trash2, Plus, BookOpen, FileText, Database, Pencil, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface KnowledgeBasesProps {
  onSelectKb: (id: string, isShared?: boolean) => void;
}

export function KnowledgeBases({ onSelectKb }: KnowledgeBasesProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [kbToEdit, setKbToEdit] = useState<KnowledgeBase | null>(null);
  const [kbToDelete, setKbToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: knowledgeBases, isLoading } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: api.listKnowledgeBases,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setKbToDelete(null);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="card" count={6} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Knowledge Bases"
        description="Manage your knowledge bases and their sources"
        actions={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Knowledge Base
          </Button>
        }
      />

      {knowledgeBases && knowledgeBases.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge bases yet"
          description="Get started by creating your first knowledge base"
          action={{
            label: "Create Knowledge Base",
            onClick: () => setShowCreateModal(true),
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {knowledgeBases?.map((kb) => (
            <div
              key={kb.id}
              className={`bg-card rounded-lg border p-5 hover:shadow-sm transition-all cursor-pointer ${
                kb.isShared
                  ? "border-purple-500/30 hover:border-purple-500/50"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => onSelectKb(kb.id, kb.isShared)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground truncate">{kb.name}</h3>
                    {kb.isShared && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded-full shrink-0">
                        <Share2 className="w-3 h-3" />
                        Shared
                      </span>
                    )}
                  </div>
                  {kb.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{kb.description}</p>
                  )}
                </div>
                {!kb.isShared && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setKbToEdit(kb);
                      }}
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setKbToDelete({ id: kb.id, name: kb.name });
                      }}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileText className="w-4 h-4" />
                  {kb.sourceCount ?? 0} sources
                </span>
                <span className="inline-flex items-center gap-1">
                  <Database className="w-4 h-4" />
                  {kb.chunkCount ?? 0} chunks
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground/60">
                  Created {new Date(kb.createdAt).toLocaleDateString()}
                </span>
                {kb.isShared && (
                  <span className="text-xs text-purple-500 dark:text-purple-400 italic">Read-only</span>
                )}
                {kb.reindexStatus && (
                  <ReindexStatusBadge status={kb.reindexStatus} progress={kb.reindexProgress} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <CreateKbModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
      />

      {/* Edit Modal */}
      {kbToEdit && (
        <EditKbModal
          kb={kbToEdit}
          open={true}
          onOpenChange={(open) => {
            if (!open) setKbToEdit(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!kbToDelete}
        onOpenChange={(open) => {
          if (!open) setKbToDelete(null);
        }}
        title="Delete Knowledge Base"
        description={`Are you sure you want to delete "${kbToDelete?.name}"? This will remove all sources and content. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (kbToDelete) {
            deleteMutation.mutate(kbToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function CreateKbModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState<string>("");

  // Fetch embedding models for the selector
  const { data: modelsData } = useQuery({
    queryKey: ["models", "embedding"],
    queryFn: async () => {
      const res = await api.listModels({ type: "embedding" });
      return res.models;
    },
    enabled: open,
  });
  const embeddingModels = modelsData || [];

  const createMutation = useMutation({
    mutationFn: api.createKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      onOpenChange(false);
      setName("");
      setDescription("");
      setSelectedEmbeddingModelId("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      embeddingModelId: selectedEmbeddingModelId || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Knowledge Base</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Knowledge Base"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Embedding Model</Label>
            <p className="text-xs text-muted-foreground">
              Select which embedding model to use for this knowledge base
            </p>
            <Select
              value={selectedEmbeddingModelId || "default"}
              onValueChange={(value) => setSelectedEmbeddingModelId(value === "default" ? "" : value)}
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
                    {model.isDefault && " - Default"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {createMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{createMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Reindex Status Badge
// ============================================================================

function ReindexStatusBadge({
  status,
  progress,
}: {
  status: "pending" | "in_progress" | "failed";
  progress?: number | null;
}) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive rounded-full">
        <AlertCircle className="w-3 h-3" />
        Reindex Failed
      </span>
    );
  }

  if (status === "pending" || status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" />
        Reindexing{progress != null ? ` ${progress}%` : "..."}
      </span>
    );
  }

  return null;
}

// ============================================================================
// Edit KB Modal
// ============================================================================

function EditKbModal({
  kb,
  open,
  onOpenChange,
}: {
  kb: KnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(kb.name);
  const [description, setDescription] = useState(kb.description || "");
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState<string>(
    kb.embeddingModelId || ""
  );
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);

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

  // Get current model info
  const currentModel = embeddingModels.find((m) => m.id === kb.embeddingModelId);
  const selectedModel = embeddingModels.find((m) => m.id === selectedEmbeddingModelId);
  const modelChanged = selectedEmbeddingModelId !== (kb.embeddingModelId || "");

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      api.updateKnowledgeBase(kb.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      if (!modelChanged) {
        onOpenChange(false);
      }
    },
  });

  const reindexMutation = useMutation({
    mutationFn: (embeddingModelId: string) =>
      api.reindexKnowledgeBase(kb.id, embeddingModelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setShowReindexConfirm(false);
      onOpenChange(false);
    },
  });

  const cancelReindexMutation = useMutation({
    mutationFn: () => api.cancelKbReindex(kb.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Update name/description if changed
    const updates: { name?: string; description?: string } = {};
    if (name !== kb.name) updates.name = name;
    if (description !== (kb.description || "")) updates.description = description || undefined;

    if (Object.keys(updates).length > 0) {
      updateMutation.mutate(updates);
    }

    // If model changed, show confirmation
    if (modelChanged && selectedEmbeddingModelId) {
      setShowReindexConfirm(true);
    } else if (Object.keys(updates).length === 0) {
      onOpenChange(false);
    }
  };

  const handleReindexConfirm = () => {
    if (selectedEmbeddingModelId) {
      reindexMutation.mutate(selectedEmbeddingModelId);
    }
  };

  const isReindexing = kb.reindexStatus === "pending" || kb.reindexStatus === "in_progress";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Knowledge Base</DialogTitle>
        </DialogHeader>

        {showReindexConfirm ? (
          <div className="space-y-4">
            <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
              <h3 className="font-medium text-warning mb-2 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Change Embedding Model
              </h3>
              <p className="text-sm text-muted-foreground">
                You are changing the embedding model from{" "}
                <strong>{currentModel?.displayName || "default"}</strong> to{" "}
                <strong>{selectedModel?.displayName}</strong>.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                This will re-embed all {kb.chunkCount || 0} chunks in the background. 
                The knowledge base will remain usable during this process.
              </p>
            </div>

            {reindexMutation.error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{reindexMutation.error.message}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowReindexConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleReindexConfirm}
                disabled={reindexMutation.isPending}
              >
                {reindexMutation.isPending ? "Starting..." : "Start Reindex"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Knowledge Base"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Embedding Model</Label>
              {isReindexing ? (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      <span className="text-sm">
                        Reindexing to {embeddingModels.find((m) => m.id === kb.pendingEmbeddingModelId)?.displayName}...
                        {kb.reindexProgress != null && ` (${kb.reindexProgress}%)`}
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
              ) : kb.reindexStatus === "failed" ? (
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
                    Changing the embedding model will re-embed all content in the background.
                  </p>
                  <Select
                    value={selectedEmbeddingModelId || "none"}
                    onValueChange={(value) => setSelectedEmbeddingModelId(value === "none" ? "" : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select embedding model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled>
                        Select a model
                      </SelectItem>
                      {embeddingModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.displayName} ({model.dimensions}D)
                          {model.id === kb.embeddingModelId && " - Current"}
                          {model.isDefault && " - Default"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {updateMutation.error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{updateMutation.error.message}</p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending || !name.trim() || isReindexing}
              >
                {updateMutation.isPending ? "Saving..." : modelChanged ? "Save & Reindex" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
