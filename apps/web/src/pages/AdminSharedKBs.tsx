import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SharedKnowledgeBase } from "../lib/api";
import {
  Globe,
  GlobeLock,
  Share2,
  Plus,
  Trash2,
  FileText,
  Database,
  Users,
  Eye,
  EyeOff,
  Pencil,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { InfoBox } from "@/components/ui/info-box";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AdminSharedKBsProps {
  onSelectKb?: (id: string) => void;
}

export function AdminSharedKBs({ onSelectKb }: AdminSharedKBsProps) {
  const [selectedKb, setSelectedKb] = useState<SharedKnowledgeBase | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [kbToEdit, setKbToEdit] = useState<SharedKnowledgeBase | null>(null);
  const [kbToDelete, setKbToDelete] = useState<SharedKnowledgeBase | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-shared-kbs"],
    queryFn: api.listSharedKbs,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
      setKbToDelete(null);
    },
  });

  const publishMutation = useMutation({
    mutationFn: api.publishSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: api.unpublishSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Shared Knowledge Bases"
        description="Create and manage global knowledge bases that can be shared with all tenants or specific tenants."
        actions={
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Global KB
          </Button>
        }
      />

      {/* Info Box */}
      <InfoBox title="How Sharing Works" className="mb-6">
        <strong>Published</strong> knowledge bases are visible to <strong>all tenants</strong> automatically.
        You can also share unpublished KBs with <strong>specific tenants</strong> for selective access.
        Shared KBs are read-only for tenants - they can use them in their agents but cannot modify them.
      </InfoBox>

      {/* Knowledge Bases Table */}
      {(!data?.knowledgeBases || data.knowledgeBases.length === 0) ? (
        <EmptyState
          icon={Database}
          title="No shared knowledge bases yet"
          description="Create a global knowledge base to share with tenants."
          action={{
            label: "Create Global KB",
            onClick: () => setIsCreateModalOpen(true),
          }}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Shared With</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.knowledgeBases.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell>
                    <button
                      onClick={() => onSelectKb?.(kb.id)}
                      className="text-left group"
                    >
                      <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {kb.name}
                      </div>
                      {kb.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-xs">{kb.description}</div>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    {kb.isPublished ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-success/15 text-success rounded">
                        <Globe className="w-3 h-3" />
                        Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
                        <GlobeLock className="w-3 h-3" />
                        Unpublished
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1" title="Sources">
                        <FileText className="w-4 h-4" />
                        {kb.sourceCount}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Chunks">
                        <Database className="w-4 h-4" />
                        {kb.chunkCount}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {kb.isPublished ? (
                      <span className="text-sm text-success">All tenants</span>
                    ) : kb.shareCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-sm text-primary">
                        <Users className="w-4 h-4" />
                        {kb.shareCount} tenant{kb.shareCount !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground/60">No one</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {new Date(kb.createdAt).toLocaleDateString()}
                    </div>
                    {kb.creatorEmail && (
                      <div className="text-xs text-muted-foreground/60">{kb.creatorEmail}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setKbToEdit(kb)}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedKb(kb)}
                        title="Manage sharing"
                      >
                        <Share2 className="w-4 h-4" />
                      </Button>
                      {kb.isPublished ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-warning"
                          onClick={() => unpublishMutation.mutate(kb.id)}
                          title="Unpublish"
                          disabled={unpublishMutation.isPending}
                        >
                          <EyeOff className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-success"
                          onClick={() => publishMutation.mutate(kb.id)}
                          title="Publish to all tenants"
                          disabled={publishMutation.isPending}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setKbToDelete(kb)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Modal */}
      <CreateKbModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
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

      {/* Detail/Sharing Modal */}
      {selectedKb && (
        <KbDetailModal
          kbId={selectedKb.id}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedKb(null);
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState("");
  const queryClient = useQueryClient();

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

  const createMutation = useMutation({
    mutationFn: api.createSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
      onOpenChange(false);
      setName("");
      setDescription("");
      setSelectedEmbeddingModelId("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      description: description || undefined,
      embeddingModelId: selectedEmbeddingModelId || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Global Knowledge Base</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Company Policies"
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this knowledge base about?"
              rows={3}
              maxLength={500}
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

          <p className="text-xs text-muted-foreground bg-muted p-3 rounded-lg">
            After creating, you can add sources and content. The KB will not be visible to any
            tenants until you publish it or share it with specific tenants.
          </p>

          {createMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{createMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name}>
              {createMutation.isPending ? "Creating..." : "Create KB"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditKbModal({
  kb,
  open,
  onOpenChange,
}: {
  kb: SharedKnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(kb.name);
  const [description, setDescription] = useState(kb.description || "");
  const queryClient = useQueryClient();

  // Reset form when kb changes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setName(kb.name);
      setDescription(kb.description || "");
    }
    onOpenChange(isOpen);
  };

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      api.updateSharedKb(kb.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kb", kb.id] });
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updates: { name?: string; description?: string } = {};
    if (name !== kb.name) updates.name = name;
    if (description !== (kb.description || "")) updates.description = description || undefined;
    
    if (Object.keys(updates).length > 0) {
      updateMutation.mutate(updates);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Knowledge Base</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Company Policies"
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this knowledge base about?"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="p-3 bg-muted rounded-lg text-xs text-muted-foreground">
            <p>
              <strong>Note:</strong> The embedding model cannot be changed after creation. 
              If you need a different embedding model, create a new knowledge base.
            </p>
          </div>

          {updateMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{updateMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !name}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KbDetailModal({
  kbId,
  open,
  onOpenChange,
}: {
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [showTenantSelect, setShowTenantSelect] = useState(false);
  const queryClient = useQueryClient();

  const { data: kbData, isLoading } = useQuery({
    queryKey: ["admin-shared-kb", kbId],
    queryFn: () => api.getSharedKb(kbId),
    enabled: open,
  });

  const { data: tenantsData } = useQuery({
    queryKey: ["admin-shared-kb-tenants", kbId],
    queryFn: () => api.getAvailableTenants(kbId),
    enabled: open && showTenantSelect,
  });

  const shareMutation = useMutation({
    mutationFn: (tenantId: string) => api.shareKbWithTenant(kbId, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kb", kbId] });
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kb-tenants", kbId] });
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
      setShowTenantSelect(false);
    },
  });

  const unshareMutation = useMutation({
    mutationFn: (tenantId: string) => api.unshareKbFromTenant(kbId, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kb", kbId] });
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kb-tenants", kbId] });
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
    },
  });

  const kb = kbData?.knowledgeBase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Sharing</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : kb ? (
          <div className="space-y-4">
            {/* KB Info */}
            <div>
              <h3 className="text-sm font-medium text-foreground">{kb.name}</h3>
              {kb.description && (
                <p className="text-sm text-muted-foreground mt-1">{kb.description}</p>
              )}
            </div>

            {/* Status */}
            <div className="p-3 bg-muted rounded-lg">
              {kb.isPublished ? (
                <div className="flex items-center gap-2 text-success">
                  <Globe className="w-4 h-4" />
                  <span className="text-sm font-medium">Published - visible to all tenants</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <GlobeLock className="w-4 h-4" />
                  <span className="text-sm font-medium">Unpublished - only shared tenants can access</span>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
                {kb.sourceCount} source{kb.sourceCount !== 1 ? "s" : ""}
              </div>
              <div className="flex items-center gap-1">
                <Database className="w-4 h-4" />
                {kb.chunkCount} chunk{kb.chunkCount !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Shared With Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase text-muted-foreground">
                  Specifically Shared With
                </Label>
                {!kb.isPublished && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setShowTenantSelect(!showTenantSelect)}
                    className="h-auto p-0"
                  >
                    {showTenantSelect ? "Cancel" : "+ Add Tenant"}
                  </Button>
                )}
              </div>

              {kb.isPublished && (
                <p className="text-sm text-muted-foreground italic">
                  This KB is published and visible to all tenants. Unpublish to manage specific sharing.
                </p>
              )}

              {!kb.isPublished && showTenantSelect && (
                <div className="mb-3 p-3 bg-primary/5 border border-primary/10 rounded-lg">
                  <Label className="text-sm mb-2 block">Select tenant to share with:</Label>
                  <select
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    onChange={(e) => {
                      if (e.target.value) {
                        shareMutation.mutate(e.target.value);
                      }
                    }}
                    defaultValue=""
                    disabled={shareMutation.isPending}
                  >
                    <option value="">Choose a tenant...</option>
                    {tenantsData?.tenants
                      .filter((t) => !t.isShared)
                      .map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name} ({tenant.slug})
                        </option>
                      ))}
                  </select>
                  {shareMutation.error && (
                    <p className="text-xs text-destructive mt-1">{shareMutation.error.message}</p>
                  )}
                </div>
              )}

              {!kb.isPublished && kb.sharedWithTenants.length > 0 ? (
                <div className="space-y-2">
                  {kb.sharedWithTenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                    >
                      <div>
                        <span className="text-sm font-medium text-foreground">{tenant.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({tenant.slug})</span>
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => unshareMutation.mutate(tenant.id)}
                        className="text-destructive h-auto p-0"
                        disabled={unshareMutation.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : !kb.isPublished ? (
                <p className="text-sm text-muted-foreground/60 italic">
                  Not shared with any specific tenants yet.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Knowledge base not found</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
