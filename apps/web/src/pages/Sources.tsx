import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Source, type SourceRun } from "../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

interface SourcesProps {
  kbId: string;
  onBack: () => void;
}

// Supported file formats for upload
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

export function Sources({ kbId, onBack }: SourcesProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [newSource, setNewSource] = useState({
    name: "",
    type: "web" as "web" | "upload",
    mode: "single" as "single" | "list" | "sitemap" | "domain",
    url: "",
    urls: "", // For list mode - newline separated
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

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, "pending" | "uploading" | "success" | "error">>({});
  const [isDragging, setIsDragging] = useState(false);

  // Auto-dismiss notifications
  const showNotification = (type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const { data: kb } = useQuery({
    queryKey: ["knowledge-base", kbId],
    queryFn: () => api.getKnowledgeBase(kbId),
  });

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources", kbId],
    queryFn: () => api.listSources(kbId),
  });

  const { data: runs } = useQuery({
    queryKey: ["source-runs", kbId, selectedSource?.id],
    queryFn: () => api.listSourceRuns(kbId, selectedSource!.id),
    enabled: !!selectedSource,
    refetchInterval: (query) => {
      // Auto-refresh every 3 seconds if there's a pending or running run
      const data = query.state.data;
      if (data?.some(r => r.status === "pending" || r.status === "running")) {
        return 3000;
      }
      return false;
    },
  });

  const { data: sourceStats } = useQuery({
    queryKey: ["source-stats", kbId, selectedSource?.id],
    queryFn: () => api.getSourceStats(kbId, selectedSource!.id),
    enabled: !!selectedSource,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; type: string; config: Record<string, unknown> }) =>
      api.createSource(kbId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
      setShowCreateModal(false);
      setNewSource({ name: "", type: "web", mode: "single", url: "", urls: "", depth: 3, schedule: null });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; name?: string; config?: Record<string, unknown> }) =>
      api.updateSource(kbId, data.id, { name: data.name, config: data.config }),
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
    mutationFn: (id: string) => api.deleteSource(kbId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", kbId] });
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: ({ id, forceReindex = false }: { id: string; forceReindex?: boolean }) =>
      api.triggerSourceRun(kbId, id, { forceReindex }),
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

  // File upload handlers
  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    // Initialize progress for new files
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

    // Use the user-provided name, or default to first filename
    const sourceName = newSource.name.trim() || selectedFiles[0].name;

    for (const file of selectedFiles) {
      setUploadProgress((prev) => ({ ...prev, [file.name]: "uploading" }));

      try {
        // First file creates the source, subsequent files use the same source
        const result = await api.uploadFile(kbId, file, {
          sourceName: createdSourceId ? undefined : sourceName,
          sourceId: createdSourceId,
        });

        // Capture the source ID from the first upload for subsequent files
        if (!createdSourceId && result.upload?.sourceId) {
          createdSourceId = result.upload.sourceId;
        }

        setUploadProgress((prev) => ({ ...prev, [file.name]: "success" }));
        successCount++;
      } catch (err) {
        setUploadProgress((prev) => ({ ...prev, [file.name]: "error" }));
        errorCount++;
      }
    }

    // Refresh sources list
    queryClient.invalidateQueries({ queryKey: ["sources", kbId] });

    // Show summary notification
    if (successCount > 0 && errorCount === 0) {
      showNotification("success", `Successfully uploaded ${successCount} file(s)`);
      // Clear files after successful upload
      setTimeout(() => {
        setSelectedFiles([]);
        setUploadProgress({});
        setShowCreateModal(false);
        // Reset the form
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
      case "succeeded":
        return "bg-green-100 text-green-700";
      case "paused":
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "error":
      case "failed":
      case "canceled":
        return "bg-red-100 text-red-700";
      case "running":
      case "partial":
        return "bg-blue-100 text-blue-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  // Check if any run is in progress
  const hasRunningRun = runs?.some(r => r.status === "pending" || r.status === "running");

  // Get latest run for a source
  const getLatestRun = () => runs?.[0] || null;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Notification Toast */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all ${
            notification.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : notification.type === "error"
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-blue-50 text-blue-800 border border-blue-200"
          }`}
        >
          {notification.type === "success" && (
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {notification.type === "error" && (
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {notification.type === "info" && (
            <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )}
          <span className="text-sm font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{kb?.name}</h1>
          <p className="text-sm text-gray-500">Manage sources for this knowledge base</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Source
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sources List */}
        <div className="lg:col-span-2 space-y-3">
          {sources && sources.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">No sources yet</h3>
              <p className="mt-2 text-sm text-gray-500">Add a web source or upload documents</p>
            </div>
          ) : (
            sources?.map((source) => (
              <div
                key={source.id}
                onClick={() => setSelectedSource(source)}
                className={`bg-white rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedSource?.id === source.id
                    ? "border-blue-500 ring-2 ring-blue-100"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{source.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(source.status)}`}>
                        {source.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Type: {source.type}
                      {source.type === "web" && source.config.url && (
                        <> | {source.config.url as string}</>
                      )}
                    </p>
                    {/* Show page and chunk stats if this source is selected */}
                    {selectedSource?.id === source.id && sourceStats && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
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
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
                        triggerRunMutation.mutate({ id: source.id, forceReindex: true });
                      }}
                      disabled={triggerRunMutation.isPending}
                      className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
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
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
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
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete Source"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Show running indicator or last run date */}
                {selectedSource?.id === source.id && runs && runs[0]?.status === "running" ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Scraping in progress...</span>
                  </div>
                ) : selectedSource?.id === source.id && runs && runs[0]?.status === "pending" ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-yellow-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Queued, starting soon...</span>
                  </div>
                ) : source.lastRunAt ? (
                  <p className="mt-2 text-xs text-gray-400">
                    Last scraped: {new Date(source.lastRunAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* Run History Panel */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-4">Run History</h3>
          {selectedSource ? (
            runs && runs.length > 0 ? (
              <div className="space-y-3">
                {runs.map((run) => (
                  <div key={run.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(run.status)}`}>
                        {run.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Pending"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      <p>Pages seen: {run.stats?.pagesSeen ?? 0}</p>
                      <p>Pages indexed: {run.stats?.pagesIndexed ?? 0}</p>
                      {(run.stats?.pagesFailed ?? 0) > 0 && (
                        <p className="text-red-600">Failed: {run.stats.pagesFailed}</p>
                      )}
                    </div>
                    {run.error && (
                      <p className="mt-2 text-xs text-red-500">{run.error}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No runs yet</p>
            )
          ) : (
            <p className="text-sm text-gray-500">Select a source to view run history</p>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <form onSubmit={handleCreate}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Add Source</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={newSource.name}
                      onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Documentation Site"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <Select
                      value={newSource.type}
                      onValueChange={(value) => {
                        setNewSource({ ...newSource, type: value as "web" | "upload" });
                        // Reset file state when switching types
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

                  {/* File Upload UI */}
                  {newSource.type === "upload" && (
                    <div className="space-y-4">
                      {/* Drag and Drop Zone */}
                      <div
                        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                          isDragging
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-300 hover:border-gray-400"
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
                          className="mx-auto h-12 w-12 text-gray-400"
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
                        <p className="mt-2 text-sm text-gray-600">
                          <span className="font-medium text-blue-600 hover:text-blue-500 cursor-pointer">
                            Click to upload
                          </span>{" "}
                          or drag and drop
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          PDF, Word, Excel, PowerPoint, CSV, TXT, Markdown, HTML, JSON, XML
                        </p>
                      </div>

                      {/* Selected Files List */}
                      {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-gray-700">
                            Selected Files ({selectedFiles.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto space-y-2">
                            {selectedFiles.map((file) => (
                              <div
                                key={file.name}
                                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <svg
                                    className="w-5 h-5 text-gray-400 flex-shrink-0"
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
                                  <span className="text-sm text-gray-700 truncate">
                                    {file.name}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    ({(file.size / 1024).toFixed(1)} KB)
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {uploadProgress[file.name] === "uploading" && (
                                    <svg
                                      className="w-4 h-4 text-blue-500 animate-spin"
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
                                      className="w-4 h-4 text-green-500"
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
                                      className="w-4 h-4 text-red-500"
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
                                      className="p-1 text-gray-400 hover:text-red-500"
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

                      {/* Supported Formats Info */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-700 mb-2">Supported Formats:</p>
                        <div className="flex flex-wrap gap-1">
                          {SUPPORTED_FORMATS.map((format) => (
                            <span
                              key={format.ext}
                              className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-600"
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Crawl Mode</label>
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
                        <p className="mt-1 text-xs text-gray-500">
                          {newSource.mode === "single" && "Scrape a single page only"}
                          {newSource.mode === "list" && "Scrape a specific list of URLs"}
                          {newSource.mode === "sitemap" && "Discover pages from a sitemap.xml"}
                          {newSource.mode === "domain" && "Recursively crawl pages within the domain"}
                        </p>
                      </div>

                      {newSource.mode === "list" ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">URLs (one per line)</label>
                          <textarea
                            value={newSource.urls}
                            onChange={(e) => setNewSource({ ...newSource, urls: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder={"https://docs.example.com/page1\nhttps://docs.example.com/page2\nhttps://docs.example.com/page3"}
                            rows={5}
                            required
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            {newSource.mode === "single" && "URL"}
                            {newSource.mode === "sitemap" && "Sitemap URL"}
                            {newSource.mode === "domain" && "Starting URL"}
                          </label>
                          <input
                            type="url"
                            value={newSource.url}
                            onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
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
                          <label className="block text-sm font-medium text-gray-700 mb-1">Max Depth</label>
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
                          <p className="mt-1 text-xs text-gray-500">
                            How many links deep to follow from the starting URL
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Auto-Refresh Schedule</label>
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
                        <p className="mt-1 text-xs text-gray-500">
                          Automatically re-scrape this source on a schedule
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedFiles([]);
                    setUploadProgress({});
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {newSource.type === "upload" ? (
                  <button
                    type="button"
                    onClick={handleUploadFiles}
                    disabled={selectedFiles.length === 0 || Object.values(uploadProgress).some(s => s === "uploading")}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {Object.values(uploadProgress).some(s => s === "uploading")
                      ? "Uploading..."
                      : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? "s" : ""}`}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editSource && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <form onSubmit={handleEdit}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Edit Source</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={editSource.name}
                      onChange={(e) => setEditSource({ ...editSource, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      required
                    />
                  </div>
                  {editSource.type === "web" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Max Depth</label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Auto-Refresh Schedule</label>
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
                        <p className="mt-1 text-xs text-gray-500">
                          Automatically re-scrape this source on a schedule
                        </p>
                      </div>
                    </>
                  )}
                  {editSource.type === "upload" && (
                    <p className="text-sm text-gray-500">
                      File upload sources can only have their name edited. To add more files, create a new upload source.
                    </p>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditSource(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
