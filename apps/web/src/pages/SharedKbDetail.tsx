import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ArrowLeft, Globe, Database, FileText, Lock } from "lucide-react";

interface SharedKbDetailProps {
  kbId: string;
  onBack: () => void;
}

export function SharedKbDetail({ kbId, onBack }: SharedKbDetailProps) {
  // Fetch KB details
  const { data: kb, isLoading: kbLoading } = useQuery({
    queryKey: ["knowledge-base", kbId],
    queryFn: () => api.getKnowledgeBase(kbId),
  });

  // Fetch sources for this KB
  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ["sources", kbId],
    queryFn: () => api.listSources(kbId),
  });

  const isLoading = kbLoading || sourcesLoading;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-24 bg-gray-200 rounded-lg"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const totalChunks = kb?.chunkCount || 0;
  const totalSources = sources?.length || 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{kb?.name}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
              <Globe className="w-3 h-3" />
              Shared
            </span>
          </div>
          {kb?.description && (
            <p className="text-sm text-gray-500 mt-1">{kb.description}</p>
          )}
        </div>
      </div>

      {/* Read-only Banner */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-medium text-amber-800">Shared Knowledge Base</h3>
          <p className="text-sm text-amber-700 mt-1">
            This knowledge base is shared with your organization. Content is managed by administrators and cannot be modified.
          </p>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalSources}</p>
              <p className="text-sm text-gray-500">Sources</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Database className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalChunks.toLocaleString()}</p>
              <p className="text-sm text-gray-500">Chunks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sources List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Sources</h2>
        </div>

        {sources && sources.length === 0 ? (
          <div className="p-8 text-center">
            <Database className="w-12 h-12 mx-auto text-gray-300" />
            <p className="mt-4 text-gray-500">No sources in this knowledge base yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Content will appear here once administrators add sources.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sources?.map((source) => (
              <div key={source.id} className="px-4 py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900">{source.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(source.status)}`}>
                        {source.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                      <span className="capitalize">{source.type}</span>
                      {source.type === "web" && typeof source.config?.url === "string" && (
                        <span className="truncate max-w-md">{source.config.url}</span>
                      )}
                    </div>
                    {source.lastRunAt && (
                      <p className="mt-1 text-xs text-gray-400">
                        Last updated: {new Date(source.lastRunAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
    case "succeeded":
      return "bg-green-100 text-green-700";
    case "paused":
    case "pending":
      return "bg-yellow-100 text-yellow-700";
    case "error":
    case "failed":
      return "bg-red-100 text-red-700";
    case "running":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}
