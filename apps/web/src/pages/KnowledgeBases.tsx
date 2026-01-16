import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Share2, Trash2, Plus, BookOpen, FileText, Database } from "lucide-react";
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setKbToDelete({ id: kb.id, name: kb.name });
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
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
