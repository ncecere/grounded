import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import type { Source, SourceRun } from "@/lib/api/types/sources";

const SUPPORTED_FORMATS = [
  { ext: ".pdf", desc: "PDF Documents" },
  { ext: ".docx", desc: "Word Documents" },
  { ext: ".xlsx/.xls", desc: "Excel Spreadsheets" },
  { ext: ".pptx", desc: "PowerPoint Presentations" },
  { ext: ".csv", desc: "CSV Files" },
  { ext: ".txt", desc: "Text Files" },
  { ext: ".md", desc: "Markdown Files" },
  { ext: ".html", desc: "HTML Files" },
  { ext: ".json", desc: "JSON Files" },
  { ext: ".xml", desc: "XML Files" },
];

const ACCEPTED_FILE_TYPES = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.txt,.md,.markdown,.html,.htm,.json,.xml";

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
  const [newSource, setNewSource] = useState({
    name: "",
    type: "web" as "web" | "upload",
    mode: "single" as "single" | "list" | "sitemap" | "domain",
    url: "",
    urls: "",
    depth: 3,
    schedule: null as "daily" | "weekly" | null,
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSource, setEditSource] = useState<{
    id: string;
    name: string;
    type: "web" | "upload";
    schedule: "daily" | "weekly" | null;
    depth: number;
  } | null>(null);

  const headerActions = actions ?? (
    <Button onClick={() => setShowCreateModal(true)}>Add Source</Button>
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, "pending" | "uploading" | "success" | "error">>({});
  const [isDragging, setIsDragging] = useState(false);

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
      setNewSource({ name: "", type: "web", mode: "single", url: "", urls: "", depth: 3, schedule: null });
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

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    const newProgress: Record<string, "pending"> = {};
    newFiles.forEach((f) => {
      newProgress[f.name] = "pending";
    });
    setUploadProgress((prev) => ({ ...prev, ...newProgress }));
  };

  const handleRemoveFile = (fileName: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.name !== fileName));
    setUploadProgress((prev) => {
      const newProgress = { ...prev };
      delete newProgress[fileName];
      return newProgress;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleUploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    let successCount = 0;
    let errorCount = 0;
    let createdSourceId: string | undefined;

    const sourceName = newSource.name.trim() || selectedFiles[0].name;

    for (const file of selectedFiles) {
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
        setSelectedFiles([]);
        setUploadProgress({});
        setShowCreateModal(false);
        setNewSource({
          name: "",
          type: "web",
          mode: "single",
          url: "",
          urls: "",
          depth: 3,
          schedule: null,
        });
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
        includePatterns: [],
        excludePatterns: [],
        includeSubdomains: false,
        schedule: newSource.schedule,
        firecrawlEnabled: false,
        respectRobotsTxt: true,
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

    updateMutation.mutate({
      id: editSource.id,
      name: editSource.name.trim(),
      config: {
        schedule: editSource.schedule,
        depth: editSource.depth,
      },
    });
  };

  const openEditModal = (source: Source) => {
    setEditSource({
      id: source.id,
      name: source.name,
      type: source.type as "web" | "upload",
      schedule: (source.config?.schedule as "daily" | "weekly" | null) || null,
      depth: (source.config?.depth as number) || 3,
    });
    setShowEditModal(true);
  };

  const getDisplayStatus = (run: { status: string; stage?: string | null; chunksToEmbed: number; chunksEmbedded: number }) => {
    // Use stage if run is active, otherwise use status
    if (run.status === "running" && run.stage) {
      return run.stage;
    }
    if (run.status === "succeeded" && run.chunksToEmbed > 0 && run.chunksEmbedded < run.chunksToEmbed) {
      return "embedding";
    }
    return run.status;
  };
  
  const getStageLabel = (stage: string) => {
    switch (stage) {
      case "processing":
        return "Processing pages...";
      case "indexing":
        return "Indexing content...";
      case "embedding":
        return "Embedding chunks...";
      case "completed":
        return "Completed";
      default:
        return stage;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
      case "succeeded":
      case "completed":
        return "bg-green-500/15 text-green-700 dark:text-green-400";
      case "paused":
      case "pending":
        return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
      case "error":
      case "failed":
      case "canceled":
        return "bg-red-500/15 text-red-700 dark:text-red-400";
      case "running":
      case "partial":
      case "processing":
        return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
      case "indexing":
        return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400";
      case "embedding":
        return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
      default:
        return "bg-muted text-muted-foreground";
    }
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

                  // Show stage-based progress when run is active
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

        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="font-medium text-foreground mb-4">Run History</h3>
          {selectedSource ? (
            runs && runs.length > 0 ? (
              <div className="space-y-3">
                {runs.map((run) => {
                  const displayStatus = getDisplayStatus(run);
                  const isEmbedding = displayStatus === "embedding";
                  const embeddingPercent = run.chunksToEmbed > 0
                    ? Math.round((run.chunksEmbedded / run.chunksToEmbed) * 100)
                    : 0;

                  return (
                    <div key={run.id} className="p-3 bg-muted rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(displayStatus)}`}>
                          {displayStatus}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Pending"}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <p>Pages seen: {run.stats?.pagesSeen ?? 0}</p>
                        <p>Pages indexed: {run.stats?.pagesIndexed ?? 0}</p>
                        {(run.stats?.pagesFailed ?? 0) > 0 && (
                          <p className="text-destructive">Failed: {run.stats.pagesFailed}</p>
                        )}
                      </div>
                      {(isEmbedding || (run.chunksToEmbed > 0 && run.chunksEmbedded > 0)) && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span className="flex items-center gap-1">
                              {isEmbedding && (
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                              )}
                              Embeddings
                            </span>
                            <span>{run.chunksEmbedded} / {run.chunksToEmbed} chunks ({embeddingPercent}%)</span>
                          </div>
                          <div className="w-full bg-muted-foreground/20 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${isEmbedding ? "bg-purple-500" : "bg-green-500"}`}
                              style={{ width: `${embeddingPercent}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      {run.error && (
                        <p className="mt-2 text-xs text-destructive">{run.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No runs yet</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Select a source to view run history</p>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 border border-border">
            <form onSubmit={handleCreate}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-foreground">Add Source</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Name</label>
                    <input
                      type="text"
                      value={newSource.name}
                      onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                      placeholder="Documentation Site"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                    <Select
                      value={newSource.type}
                      onValueChange={(value) => {
                        setNewSource({ ...newSource, type: value as "web" | "upload" });
                        if (value === "web") {
                          setSelectedFiles([]);
                          setUploadProgress({});
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select source type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="web">Web Scraping</SelectItem>
                        <SelectItem value="upload">File Upload</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {newSource.type === "upload" && (
                    <div className="space-y-4">
                      <div
                        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                          isDragging
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={ACCEPTED_FILE_TYPES}
                          className="hidden"
                          onChange={(e) => handleFileSelect(e.target.files)}
                        />
                        <svg
                          className="mx-auto h-12 w-12 text-muted-foreground"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        <p className="mt-2 text-sm text-muted-foreground">
                          <span className="font-medium text-primary hover:text-primary/80 cursor-pointer">
                            Click to upload
                          </span>{" "}
                          or drag and drop
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          PDF, Word, Excel, PowerPoint, CSV, TXT, Markdown, HTML, JSON, XML
                        </p>
                      </div>

                      {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-foreground">
                            Selected Files ({selectedFiles.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto space-y-2">
                            {selectedFiles.map((file) => (
                              <div
                                key={file.name}
                                className="flex items-center justify-between p-2 bg-muted rounded-lg"
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <svg
                                    className="w-5 h-5 text-muted-foreground shrink-0"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                    />
                                  </svg>
                                  <span className="text-sm text-foreground truncate">
                                    {file.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    ({(file.size / 1024).toFixed(1)} KB)
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {uploadProgress[file.name] === "uploading" && (
                                    <svg
                                      className="w-4 h-4 text-primary animate-spin"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                    >
                                      <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                      />
                                      <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                      />
                                    </svg>
                                  )}
                                  {uploadProgress[file.name] === "success" && (
                                    <svg
                                      className="w-4 h-4 text-success"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  )}
                                  {uploadProgress[file.name] === "error" && (
                                    <svg
                                      className="w-4 h-4 text-destructive"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                      />
                                    </svg>
                                  )}
                                  {uploadProgress[file.name] === "pending" && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFile(file.name)}
                                      className="p-1 text-muted-foreground hover:text-destructive"
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M6 18L18 6M6 6l12 12"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="bg-muted rounded-lg p-3">
                        <p className="text-xs font-medium text-foreground mb-2">Supported Formats:</p>
                        <div className="flex flex-wrap gap-1">
                          {SUPPORTED_FORMATS.map((format) => (
                            <span
                              key={format.ext}
                              className="px-2 py-0.5 bg-card border border-border rounded text-xs text-muted-foreground"
                              title={format.desc}
                            >
                              {format.ext}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {newSource.type === "web" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Crawl Mode</label>
                        <Select
                          value={newSource.mode}
                          onValueChange={(value) => setNewSource({ ...newSource, mode: value as "single" | "list" | "sitemap" | "domain" })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select crawl mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="single">Single Page</SelectItem>
                            <SelectItem value="list">List of URLs</SelectItem>
                            <SelectItem value="sitemap">Sitemap</SelectItem>
                            <SelectItem value="domain">Crawl Domain</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {newSource.mode === "single" && "Scrape a single page only"}
                          {newSource.mode === "list" && "Scrape a specific list of URLs"}
                          {newSource.mode === "sitemap" && "Discover pages from a sitemap.xml"}
                          {newSource.mode === "domain" && "Recursively crawl pages within the domain"}
                        </p>
                      </div>

                      {newSource.mode === "list" ? (
                        <div>
                          <label className="block text-sm font-medium text-foreground">URLs (one per line)</label>
                          <textarea
                            value={newSource.urls}
                            onChange={(e) => setNewSource({ ...newSource, urls: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                            placeholder={"https://docs.example.com/page1\nhttps://docs.example.com/page2\nhttps://docs.example.com/page3"}
                            rows={5}
                            required
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-foreground">
                            {newSource.mode === "single" && "URL"}
                            {newSource.mode === "sitemap" && "Sitemap URL"}
                            {newSource.mode === "domain" && "Starting URL"}
                          </label>
                          <input
                            type="url"
                            value={newSource.url}
                            onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                            placeholder={
                              newSource.mode === "sitemap"
                                ? "https://docs.example.com/sitemap.xml"
                                : "https://docs.example.com"
                            }
                            required
                          />
                        </div>
                      )}

                      {newSource.mode === "domain" && (
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">Max Depth</label>
                          <Select
                            value={String(newSource.depth)}
                            onValueChange={(value) => setNewSource({ ...newSource, depth: parseInt(value) })}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select max depth" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1 level</SelectItem>
                              <SelectItem value="2">2 levels</SelectItem>
                              <SelectItem value="3">3 levels</SelectItem>
                              <SelectItem value="5">5 levels</SelectItem>
                              <SelectItem value="10">10 levels</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="mt-1 text-xs text-muted-foreground">
                            How many links deep to follow from the starting URL
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Auto-Refresh Schedule</label>
                        <Select
                          value={newSource.schedule || "none"}
                          onValueChange={(value) => setNewSource({ ...newSource, schedule: value === "none" ? null : value as "daily" | "weekly" })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select refresh schedule" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No auto-refresh</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Automatically re-scrape this source on a schedule
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 bg-muted/50 rounded-b-lg flex justify-end gap-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedFiles([]);
                    setUploadProgress({});
                  }}
                >
                  Cancel
                </Button>
                {newSource.type === "upload" ? (
                  <Button
                    type="button"
                    onClick={handleUploadFiles}
                    disabled={selectedFiles.length === 0 || Object.values(uploadProgress).some((s) => s === "uploading")}
                  >
                    {Object.values(uploadProgress).some((s) => s === "uploading")
                      ? "Uploading..."
                      : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? "s" : ""}`}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editSource && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 border border-border">
            <form onSubmit={handleEdit}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-foreground">Edit Source</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Name</label>
                    <input
                      type="text"
                      value={editSource.name}
                      onChange={(e) => setEditSource({ ...editSource, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Max Depth</label>
                    <Select
                      value={String(editSource.depth)}
                      onValueChange={(value) => setEditSource({ ...editSource, depth: parseInt(value) })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select max depth" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 level</SelectItem>
                        <SelectItem value="2">2 levels</SelectItem>
                        <SelectItem value="3">3 levels</SelectItem>
                        <SelectItem value="5">5 levels</SelectItem>
                        <SelectItem value="10">10 levels</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Auto-Refresh Schedule</label>
                    <Select
                      value={editSource.schedule || "none"}
                      onValueChange={(value) => setEditSource({ ...editSource, schedule: value === "none" ? null : value as "daily" | "weekly" })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select refresh schedule" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No auto-refresh</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Automatically re-scrape this source on a schedule
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-muted/50 rounded-b-lg flex justify-end gap-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditSource(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
