import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type KnowledgeBase } from "../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

interface KnowledgeBasesProps {
  onSelectKb: (id: string) => void;
}

export function KnowledgeBases({ onSelectKb }: KnowledgeBasesProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState<string>("");

  const { data: knowledgeBases, isLoading } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: api.listKnowledgeBases,
  });

  // Fetch embedding models for the selector
  const { data: modelsData } = useQuery({
    queryKey: ["models", "embedding"],
    queryFn: async () => {
      const res = await api.listModels({ type: "embedding" });
      return res.models;
    },
  });
  const embeddingModels = modelsData || [];

  const createMutation = useMutation({
    mutationFn: api.createKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setShowCreateModal(false);
      setNewKbName("");
      setNewKbDescription("");
      setSelectedEmbeddingModelId("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKbName.trim()) return;
    createMutation.mutate({
      name: newKbName.trim(),
      description: newKbDescription.trim() || undefined,
      embeddingModelId: selectedEmbeddingModelId || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Bases</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your knowledge bases and their sources
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Knowledge Base
        </button>
      </div>

      {knowledgeBases && knowledgeBases.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No knowledge bases yet</h3>
          <p className="mt-2 text-sm text-gray-500">Get started by creating your first knowledge base</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Create Knowledge Base
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {knowledgeBases?.map((kb) => (
            <div
              key={kb.id}
              className="bg-white rounded-lg border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
              onClick={() => onSelectKb(kb.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{kb.name}</h3>
                  {kb.description && (
                    <p className="mt-1 text-sm text-gray-500 line-clamp-2">{kb.description}</p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Are you sure you want to delete this knowledge base?")) {
                      deleteMutation.mutate(kb.id);
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                <span>{kb.sourceCount ?? 0} sources</span>
                <span>{kb.chunkCount ?? 0} chunks</span>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Created {new Date(kb.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <form onSubmit={handleCreate}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Create Knowledge Base</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={newKbName}
                      onChange={(e) => setNewKbName(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="My Knowledge Base"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      value={newKbDescription}
                      onChange={(e) => setNewKbDescription(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Optional description..."
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Embedding Model</label>
                    <p className="text-xs text-gray-500 mt-0.5 mb-1">
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
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
