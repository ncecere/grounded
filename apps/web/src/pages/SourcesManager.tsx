import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import type { Source, SourceRun } from "@/lib/api/types/sources";
import { getDisplayStatus, getStageLabel, getStatusColor } from "./sources/source-utils";
import { SourceRunHistory } from "./sources/SourceRunHistory";
import { CreateSourceModal, type UploadProgressMap } from "./sources/CreateSourceModal";
import { EditSourceModal, type EditSourceData } from "./sources/EditSourceModal";

export interface SourcesManagerProps {
  kbId: string;
  onBack: () => void;
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  listSources: (kbId: string) => Promise<Source[]>;
  listSourceRuns: (kbId: string, sourceId: string) => Promise<SourceRun[]>;
  getSourceStats: (kbId: string, sourceId: string) => Promise<{ pageCount: number; chunkCount: number }>;
  createSource: (kbId: string, data: { name: string; type: string; config: Record<string, unknown> }) => Promise<Source>;
  updateSource: (kbId: string, sourceId: string, data: { name?: string; config?: Record<string, unknown> }) => Promise<Source>;
  deleteSource: (kbId: string, sourceId: string) => Promise<void>;
  triggerSourceRun: (kbId: string, sourceId: string, options?: { forceReindex?: boolean }) => Promise<SourceRun>;
  cancelSourceRun: (kbId: string, runId: string, sourceId?: string) => Promise<SourceRun>;
  uploadFile: (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string }) => Promise<unknown>;
  isAdminView?: boolean;
}

export function SourcesManager({
  kbId,
  onBack,
  title,
  description,
  actions,
  listSources,
  listSourceRuns,
  getSourceStats,
  createSource,
  updateSource,
  deleteSource,
  triggerSourceRun,
  cancelSourceRun,
  uploadFile,
}: SourcesManagerProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const defaultNewSource = {
    name: "",
    type: "web" as "web" | "upload",
    mode: "single" as "single" | "list" | "sitemap" | "domain",
    url: "",
    urls: "",
    depth: 3,
    schedule: null as "daily" | "weekly" | null,
    includePatterns: "",
    excludePatterns: "",
    includeSubdomains: false,
    respectRobotsTxt: true,
  };
  const [newSource, setNewSource] = useState(defaultNewSource);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSource, setEditSource] = useState<EditSourceData | null>(null);

  const headerActions = actions ?? (
    <Button onClick={() => setShowCreateModal(true)}>Add Source</Button>
  );

  const [uploadProgress, setUploadProgress] = useState<UploadProgressMap>({});

  const showNotification = (type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources", kbId],
    queryFn: () => listSources(kbId),
  });

  const { data: runs } = useQuery({
    queryKey: ["source-runs", kbId, selectedSource?.id],
    queryFn: () => listSourceRuns(kbId, selectedSource!.id),
    enabled: !!selectedSource,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some(
        (r) => r.status === "pending" || r.status === "running"
      )) {
        return 3000;
      }
      return false;
    },
  });

  const { data: sourceStats } = useQuery({
    queryKey: ["source-stats", kbId, selectedSource?.id],
    queryFn: () => getSourceStats(kbId, selectedSource!.id),
    enabled: !!selectedSource,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; type: string; config: Record<string, unknown> }) =>
      createSource(kbId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      setShowCreateModal(false);
      setNewSource(defaultNewSource);
      showNotification("success", "Source created successfully");
    },
    onError: (error: Error) => {
      showNotification("error", error.message || "Failed to create source");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; name?: string; config?: Record<string, unknown> }) =>
      updateSource(kbId, data.id, { name: data.name, config: data.config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      setShowEditModal(false);
      setEditSource(null);
      showNotification("success", "Source updated successfully");
    },
    onError: (error: Error) => {
      showNotification("error", error.message || "Failed to update source");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSource(kbId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      if (selectedSource?.id) {
        setSelectedSource(null);
      }
      showNotification("success", "Source deleted");
    },
    onError: (error: Error) => {
      showNotification("error", error.message || "Failed to delete source");
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: ({ id, forceReindex = false }: { id: string; forceReindex?: boolean }) =>
      triggerSourceRun(kbId, id, { forceReindex }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      queryClient.invalidateQueries({ queryKey: ["source-runs", kbId] });
      queryClient.invalidateQueries({ queryKey: ["source-stats", kbId] });
      const message = variables.forceReindex
        ? "Force re-index started! All pages will be re-processed."
        : "Scraping started! This may take a few minutes.";
      showNotification("info", message);
    },
    onError: (error: Error) => {
      showNotification("error", error.message || "Failed to start scraping");
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => cancelSourceRun(kbId, runId, selectedSource?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      queryClient.invalidateQueries({ queryKey: ["source-runs", kbId] });
      queryClient.invalidateQueries({ queryKey: ["source-stats", kbId] });
      showNotification("info", "Run cancelled.");
    },
    onError: (error: Error) => {
      showNotification("error", error.message || "Failed to cancel run");
    },
  });

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;

    let successCount = 0;
    let errorCount = 0;
    let createdSourceId: string | undefined;

    const sourceName = newSource.name.trim() || files[0].name;

    for (const file of files) {
      setUploadProgress((prev) => ({ ...prev, [file.name]: "uploading" }));

      try {
        const result = await uploadFile(kbId, file, {
          sourceName: createdSourceId ? undefined : sourceName,
          sourceId: createdSourceId,
        });

        const upload = (result as { upload?: { sourceId?: string } })?.upload;
        if (!createdSourceId && upload?.sourceId) {
          createdSourceId = upload.sourceId;
        }

        setUploadProgress((prev) => ({ ...prev, [file.name]: "success" }));
        successCount++;
      } catch (err) {
        setUploadProgress((prev) => ({ ...prev, [file.name]: "error" }));
        errorCount++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["sources", kbId] });

    if (successCount > 0 && errorCount === 0) {
      showNotification("success", `Successfully uploaded ${successCount} file(s)`);
      setTimeout(() => {
        setUploadProgress({});
        setShowCreateModal(false);
        setNewSource(defaultNewSource);
      }, 1500);
    } else if (errorCount > 0) {
      showNotification("error", `${errorCount} file(s) failed to upload`);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.name.trim()) return;

    let config: Record<string, unknown> = {};

    if (newSource.type === "web") {
      const baseConfig = {
        mode: newSource.mode,
        depth: newSource.depth,
        includePatterns: newSource.includePatterns
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
        excludePatterns: newSource.excludePatterns
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
        includeSubdomains: newSource.includeSubdomains,
        schedule: newSource.schedule,
        firecrawlEnabled: false,
        respectRobotsTxt: newSource.respectRobotsTxt,
      };

      switch (newSource.mode) {
        case "single":
          config = { ...baseConfig, url: newSource.url };
          break;
        case "list":
          config = {
            ...baseConfig,
            urls: newSource.urls
              .split("\n")
              .map((u) => u.trim())
              .filter((u) => u.length > 0),
          };
          break;
        case "sitemap":
          config = { ...baseConfig, url: newSource.url };
          break;
        case "domain":
          config = { ...baseConfig, url: newSource.url };
          break;
      }
    }

    createMutation.mutate({
      name: newSource.name.trim(),
      type: newSource.type,
      config,
    });
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSource) return;

    const config: Record<string, unknown> = {
      schedule: editSource.schedule,
      depth: editSource.depth,
    };

    // Only include web-specific config for web sources
    if (editSource.type === "web") {
      config.mode = editSource.mode;
      config.includeSubdomains = editSource.includeSubdomains;
      config.respectRobotsTxt = editSource.respectRobotsTxt;
      config.includePatterns = editSource.includePatterns
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      config.excludePatterns = editSource.excludePatterns
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (editSource.mode === "list") {
        config.urls = editSource.urls
          .split("\n")
          .map((u) => u.trim())
          .filter((u) => u.length > 0);
      } else {
        config.url = editSource.url;
      }
    }

    updateMutation.mutate({
      id: editSource.id,
      name: editSource.name.trim(),
      config,
    });
  };

  const openEditModal = (source: Source) => {
    const config = source.config ?? {};
    const urls = Array.isArray(config.urls)
      ? (config.urls as string[]).join("\n")
      : "";
    const includePatterns = Array.isArray(config.includePatterns)
      ? (config.includePatterns as string[]).join("\n")
      : "";
    const excludePatterns = Array.isArray(config.excludePatterns)
      ? (config.excludePatterns as string[]).join("\n")
      : "";

    setEditSource({
      id: source.id,
      name: source.name,
      type: source.type as "web" | "upload",
      mode: (config.mode as "single" | "list" | "sitemap" | "domain") || "single",
      url: (config.url as string) || "",
      urls,
      depth: (config.depth as number) || 3,
      schedule: (config.schedule as "daily" | "weekly" | null) || null,
      includePatterns,
      excludePatterns,
      includeSubdomains: (config.includeSubdomains as boolean) ?? false,
      respectRobotsTxt: (config.respectRobotsTxt as boolean) ?? true,
    });
    setShowEditModal(true);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="table" count={3} />
      </div>
    );
  }

  return (
    <div className="p-6">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all ${
            notification.type === "success"
              ? "bg-green-500/15 text-green-800 dark:text-green-300 border border-green-500/30"
              : notification.type === "error"
              ? "bg-red-500/15 text-red-800 dark:text-red-300 border border-red-500/30"
              : "bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30"
          }`}
        >
          {notification.type === "success" && (
            <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {notification.type === "error" && (
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {notification.type === "info" && (
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )}
          <span className="text-sm font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <PageHeader
        title={title}
        description={description}
        backButton={{ onClick: onBack }}
        actions={headerActions}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {sources && sources.length === 0 ? (
            <EmptyState
              title="No sources yet"
              description="Add a web source or upload documents"
            />
          ) : (
            sources?.map((source) => (
              <div
                key={source.id}
                onClick={() => setSelectedSource(source)}
                className={`bg-card rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedSource?.id === source.id
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{source.name}</h3>
                      {(() => {
                        const latestRun = selectedSource?.id === source.id ? runs?.[0] : undefined;
                        const latestDisplayStatus = latestRun ? getDisplayStatus(latestRun) : undefined;
                        const badgeStatus = latestDisplayStatus || source.lastRunStatus || source.status;
                        return (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(badgeStatus)}`}>
                            {badgeStatus}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Type: {source.type}
                      {source.type === "web" && Boolean(source.config.url) && (
                        <> | {String(source.config.url)}</>
                      )}
                    </p>
                    {selectedSource?.id === source.id && sourceStats && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {sourceStats.pageCount} pages
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                          </svg>
                          {sourceStats.chunkCount} chunks
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerRunMutation.mutate({ id: source.id });
                      }}
                      disabled={triggerRunMutation.isPending}
                      className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                      title="Run Now"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const latestRun = runs?.find((run) => run.sourceId === source.id);
                        if (!latestRun) return;
                        if (confirm("Stop the current run? This will cancel scraping and embedding progress.")) {
                          cancelRunMutation.mutate(latestRun.id);
                        }
                      }}
                      disabled={
                        cancelRunMutation.isPending ||
                        !runs?.some(
                          (run) =>
                            run.sourceId === source.id &&
                            ["pending", "running"].includes(run.status)
                        )
                      }
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Stop Run"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h6v6H9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerRunMutation.mutate({ id: source.id, forceReindex: true });
                      }}
                      disabled={triggerRunMutation.isPending}
                      className="p-2 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors"
                      title="Force Re-index (ignore cache)"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(source);
                      }}
                      className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                      title="Edit Source"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Are you sure you want to delete this source?")) {
                          deleteMutation.mutate(source.id);
                        }
                      }}
                      className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete Source"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                {selectedSource?.id === source.id && runs && runs[0] && (() => {
                  const latestRun = runs[0];
                  const latestDisplayStatus = getDisplayStatus(latestRun);
                  const isEmbeddingActive = latestRun.chunksToEmbed > 0
                    && latestRun.chunksEmbedded < latestRun.chunksToEmbed;
                  const embeddingPercent = latestRun.chunksToEmbed > 0
                    ? Math.round((latestRun.chunksEmbedded / latestRun.chunksToEmbed) * 100)
                    : 0;

                  if (latestDisplayStatus === "pending") {
                    return (
                      <div className="mt-2 flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Queued, starting soon...</span>
                      </div>
                    );
                  }

                  const isStageActive = ["processing", "indexing", "embedding", "running"].includes(latestDisplayStatus);

                  if (!isStageActive && !isEmbeddingActive) {
                    return null;
                  }

                  return (
                    <div className="mt-2 space-y-1">
                      {latestDisplayStatus === "processing" && (
                        <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{getStageLabel("processing")}</span>
                        </div>
                      )}
                      {latestDisplayStatus === "indexing" && (
                        <div className="flex items-center gap-2 text-xs text-cyan-600 dark:text-cyan-400">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{getStageLabel("indexing")}</span>
                        </div>
                      )}
                      {(latestDisplayStatus === "embedding" || isEmbeddingActive) && (
                        <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                          <span>{getStageLabel("embedding")} {embeddingPercent}%</span>
                        </div>
                      )}
                      {latestDisplayStatus === "running" && !latestRun.stage && (
                        <div className="flex items-center gap-2 text-xs text-primary">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Scraping in progress...</span>
                        </div>
                      )}
                    </div>
                  );
                 })()}
                {!(selectedSource?.id === source.id && runs && runs[0] &&
                  ["running", "embedding", "pending", "processing", "indexing"].includes(getDisplayStatus(runs[0]))) &&
                  source.lastRunAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last scraped: {new Date(source.lastRunAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        <SourceRunHistory runs={runs} hasSelectedSource={!!selectedSource} />
      </div>

      {showCreateModal && (
        <CreateSourceModal
          newSource={newSource}
          setNewSource={setNewSource}
          onClose={() => {
            setUploadProgress({});
            setShowCreateModal(false);
          }}
          onCreate={handleCreate}
          onUploadFiles={handleUploadFiles}
          createIsPending={createMutation.isPending}
          kbId={kbId}
          uploadFile={uploadFile}
          uploadProgress={uploadProgress}
          setUploadProgress={setUploadProgress}
        />
      )}

      {showEditModal && editSource && (
        <EditSourceModal
          editSource={editSource}
          setEditSource={setEditSource}
          onClose={() => {
            setShowEditModal(false);
            setEditSource(null);
          }}
          onEdit={handleEdit}
          updateIsPending={updateMutation.isPending}
        />
      )}
    </div>
  );
}
