import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Globe, Database, FileText, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { InfoBox } from "@/components/ui/info-box";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

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
        <LoadingSkeleton variant="stats" count={2} />
        <div className="mt-6">
          <LoadingSkeleton variant="table" count={3} />
        </div>
      </div>
    );
  }

  const totalChunks = kb?.chunkCount || 0;
  const totalSources = sources?.length || 0;

  return (
    <div className="p-6">
      {/* Header */}
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <span>{kb?.name}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 rounded">
              <Globe className="w-3 h-3" />
              Shared
            </span>
          </div>
        }
        description={kb?.description || undefined}
        backButton={{ onClick: onBack }}
      />

      {/* Read-only Banner */}
      <InfoBox variant="warning" className="mb-6">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium">Shared Knowledge Base</h3>
            <p className="text-sm mt-1">
              This knowledge base is shared with your organization. Content is managed by administrators and cannot be modified.
            </p>
          </div>
        </div>
      </InfoBox>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard
          label="Sources"
          value={totalSources}
          icon={FileText}
          iconColor="blue"
        />
        <StatCard
          label="Chunks"
          value={totalChunks.toLocaleString()}
          icon={Database}
          iconColor="green"
        />
      </div>

      {/* Sources List */}
      <div className="bg-card rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-lg font-medium text-foreground">Sources</h2>
        </div>

        {sources && sources.length === 0 ? (
          <div className="p-8 text-center">
            <Database className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="mt-4 text-muted-foreground">No sources in this knowledge base yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Content will appear here once administrators add sources.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sources?.map((source) => (
              <div key={source.id} className="px-4 py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground">{source.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(source.status)}`}>
                        {source.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="capitalize">{source.type}</span>
                      {source.type === "web" && typeof source.config?.url === "string" && (
                        <span className="truncate max-w-md">{source.config.url}</span>
                      )}
                    </div>
                    {source.lastRunAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
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
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "paused":
    case "pending":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "error":
    case "failed":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
    case "running":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
