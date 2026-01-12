import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SharedKnowledgeBase, type SharedKnowledgeBaseDetail, type AvailableTenant } from "../lib/api";
import { Globe, GlobeLock, Share2, Plus, Trash2, X, FileText, Database, Users, Eye, EyeOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

interface AdminSharedKBsProps {
  onSelectKb?: (id: string) => void;
}

export function AdminSharedKBs({ onSelectKb }: AdminSharedKBsProps) {
  const [selectedKb, setSelectedKb] = useState<SharedKnowledgeBase | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-shared-kbs"],
    queryFn: api.listSharedKbs,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
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
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shared Knowledge Bases</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage global knowledge bases that can be shared with all tenants or specific tenants.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Global KB
        </button>
      </div>

      {/* Info Box */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-sm font-medium text-blue-900 mb-1">How Sharing Works</h3>
        <p className="text-sm text-blue-700">
          <strong>Published</strong> knowledge bases are visible to <strong>all tenants</strong> automatically.
          You can also share unpublished KBs with <strong>specific tenants</strong> for selective access.
          Shared KBs are read-only for tenants - they can use them in their agents but cannot modify them.
        </p>
      </div>

      {/* Knowledge Bases Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Content
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Shared With
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data?.knowledgeBases.map((kb) => (
              <tr key={kb.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <button
                    onClick={() => onSelectKb?.(kb.id)}
                    className="text-left group"
                  >
                    <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                      {kb.name}
                    </div>
                    {kb.description && (
                      <div className="text-xs text-gray-500 truncate max-w-xs">{kb.description}</div>
                    )}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {kb.isPublished ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                      <Globe className="w-3 h-3" />
                      Published (All Tenants)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                      <GlobeLock className="w-3 h-3" />
                      Unpublished
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="inline-flex items-center gap-1" title="Sources">
                      <FileText className="w-4 h-4" />
                      {kb.sourceCount}
                    </span>
                    <span className="inline-flex items-center gap-1" title="Chunks">
                      <Database className="w-4 h-4" />
                      {kb.chunkCount}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {kb.isPublished ? (
                    <span className="text-sm text-green-600">All tenants</span>
                  ) : kb.shareCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-sm text-blue-600">
                      <Users className="w-4 h-4" />
                      {kb.shareCount} tenant{kb.shareCount !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">No one</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div>{new Date(kb.createdAt).toLocaleDateString()}</div>
                  {kb.creatorEmail && (
                    <div className="text-xs text-gray-400">{kb.creatorEmail}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setSelectedKb(kb)}
                      className="text-blue-600 hover:text-blue-800"
                      title="Manage sharing"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    {kb.isPublished ? (
                      <button
                        onClick={() => unpublishMutation.mutate(kb.id)}
                        className="text-orange-600 hover:text-orange-800"
                        title="Unpublish"
                        disabled={unpublishMutation.isPending}
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => publishMutation.mutate(kb.id)}
                        className="text-green-600 hover:text-green-800"
                        title="Publish to all tenants"
                        disabled={publishMutation.isPending}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${kb.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(kb.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-800"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(!data?.knowledgeBases || data.knowledgeBases.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No shared knowledge bases yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {isCreateModalOpen && (
        <CreateKbModal onClose={() => setIsCreateModalOpen(false)} />
      )}

      {/* Detail/Sharing Modal */}
      {selectedKb && (
        <KbDetailModal
          kbId={selectedKb.id}
          onClose={() => setSelectedKb(null)}
        />
      )}
    </div>
  );
}

function CreateKbModal({ onClose }: { onClose: () => void }) {
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
  });
  const embeddingModels = modelsData || [];

  const createMutation = useMutation({
    mutationFn: api.createSharedKb,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-shared-kbs"] });
      onClose();
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Global Knowledge Base</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="e.g., Company Policies"
              required
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="What is this knowledge base about?"
              rows={3}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Embedding Model
            </label>
            <p className="text-xs text-gray-500 mb-2">
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

          <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
            After creating, you can add sources and content. The KB will not be visible to any
            tenants until you publish it or share it with specific tenants.
          </p>

          {createMutation.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create KB"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function KbDetailModal({ kbId, onClose }: { kbId: string; onClose: () => void }) {
  const [showTenantSelect, setShowTenantSelect] = useState(false);
  const queryClient = useQueryClient();

  const { data: kbData, isLoading } = useQuery({
    queryKey: ["admin-shared-kb", kbId],
    queryFn: () => api.getSharedKb(kbId),
  });

  const { data: tenantsData } = useQuery({
    queryKey: ["admin-shared-kb-tenants", kbId],
    queryFn: () => api.getAvailableTenants(kbId),
    enabled: showTenantSelect,
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Manage Sharing</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-gray-200 rounded w-3/4"></div>
            <div className="h-5 bg-gray-200 rounded w-1/2"></div>
          </div>
        ) : kb ? (
          <div className="space-y-4">
            {/* KB Info */}
            <div>
              <h3 className="text-sm font-medium text-gray-900">{kb.name}</h3>
              {kb.description && (
                <p className="text-sm text-gray-500 mt-1">{kb.description}</p>
              )}
            </div>

            {/* Status */}
            <div className="p-3 bg-gray-50 rounded-lg">
              {kb.isPublished ? (
                <div className="flex items-center gap-2 text-green-700">
                  <Globe className="w-4 h-4" />
                  <span className="text-sm font-medium">Published - visible to all tenants</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-600">
                  <GlobeLock className="w-4 h-4" />
                  <span className="text-sm font-medium">Unpublished - only shared tenants can access</span>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-4 text-sm text-gray-600">
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
                <label className="text-xs font-medium text-gray-500 uppercase">
                  Specifically Shared With
                </label>
                {!kb.isPublished && (
                  <button
                    onClick={() => setShowTenantSelect(!showTenantSelect)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {showTenantSelect ? "Cancel" : "+ Add Tenant"}
                  </button>
                )}
              </div>

              {kb.isPublished && (
                <p className="text-sm text-gray-500 italic">
                  This KB is published and visible to all tenants. Unpublish to manage specific sharing.
                </p>
              )}

              {!kb.isPublished && showTenantSelect && (
                <div className="mb-3 p-3 bg-blue-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select tenant to share with:
                  </label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
                    <p className="text-xs text-red-600 mt-1">{shareMutation.error.message}</p>
                  )}
                </div>
              )}

              {!kb.isPublished && kb.sharedWithTenants.length > 0 ? (
                <div className="space-y-2">
                  {kb.sharedWithTenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-900">{tenant.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({tenant.slug})</span>
                      </div>
                      <button
                        onClick={() => unshareMutation.mutate(tenant.id)}
                        className="text-red-600 hover:text-red-800 text-xs"
                        disabled={unshareMutation.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : !kb.isPublished ? (
                <p className="text-sm text-gray-400 italic">
                  Not shared with any specific tenants yet.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-gray-500">Knowledge base not found</p>
        )}

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
