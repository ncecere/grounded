import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Info, Trash2, Upload, FileText, Loader2 } from "lucide-react";
import { sourcesApi, type Upload as UploadRecord } from "@/lib/api/sources";

export interface EditSourceData {
  id: string;
  name: string;
  type: "web" | "upload";
  mode: "single" | "list" | "sitemap" | "domain";
  url: string;
  urls: string;
  depth: number;
  schedule: "daily" | "weekly" | null;
  includePatterns: string;
  excludePatterns: string;
  includeSubdomains: boolean;
  respectRobotsTxt: boolean;
}

interface EditSourceModalProps {
  editSource: EditSourceData;
  setEditSource: (value: EditSourceData) => void;
  onClose: () => void;
  onEdit: (e: React.FormEvent) => void;
  updateIsPending: boolean;
  kbId?: string;
  uploadFile?: (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string; sourceRunId?: string; batch?: boolean }) => Promise<unknown>;
  finalizeUploadBatch?: (kbId: string, sourceRunId: string) => Promise<unknown>;
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-1.5 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700 dark:text-amber-300">{children}</p>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "succeeded":
      return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Ready</span>;
    case "processing":
      return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Processing</span>;
    case "pending":
      return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</span>;
    case "failed":
      return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Failed</span>;
    default:
      return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400">{status}</span>;
  }
}

function UploadFileManager({
  kbId,
  sourceId,
  uploadFile,
  finalizeUploadBatch,
}: {
  kbId: string;
  sourceId: string;
  uploadFile: (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string; sourceRunId?: string; batch?: boolean }) => Promise<unknown>;
  finalizeUploadBatch?: (kbId: string, sourceRunId: string) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, "uploading" | "success" | "error">>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: fileUploads, isLoading: uploadsLoading } = useQuery({
    queryKey: ["uploads", kbId, sourceId],
    queryFn: () => sourcesApi.listUploads(kbId, sourceId),
  });

  const { data: fileStats } = useQuery({
    queryKey: ["file-stats", kbId, sourceId],
    queryFn: () => sourcesApi.getFileStats(kbId, sourceId),
  });

  const deleteMutation = useMutation({
    mutationFn: (uploadId: string) => sourcesApi.deleteUpload(uploadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads", kbId, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["file-stats", kbId, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["source-stats", kbId] });
      setConfirmDeleteId(null);
    },
  });

  const getChunkCount = (upload: UploadRecord): number | null => {
    if (!fileStats) return null;
    const url = `upload://${upload.id}/${upload.filename}`;
    return fileStats[url] ?? 0;
  };

  const handleFiles = useCallback(async (files: File[]) => {
    const isBatch = files.length > 1 && !!finalizeUploadBatch;
    let sourceRunId: string | undefined;
    let successCount = 0;

    for (const file of files) {
      setUploadingFiles((prev) => ({ ...prev, [file.name]: "uploading" }));
      try {
        const result = await uploadFile(kbId, file, {
          sourceId,
          sourceRunId: isBatch ? sourceRunId : undefined,
          batch: isBatch || undefined,
        });
        const upload = (result as { upload?: { sourceRunId?: string } })?.upload;
        if (!sourceRunId && upload?.sourceRunId) {
          sourceRunId = upload.sourceRunId;
        }
        setUploadingFiles((prev) => ({ ...prev, [file.name]: "success" }));
        successCount++;
      } catch {
        setUploadingFiles((prev) => ({ ...prev, [file.name]: "error" }));
      }
    }

    // Finalize batch to start processing all files as one run
    if (isBatch && sourceRunId && successCount > 0) {
      try {
        await finalizeUploadBatch(kbId, sourceRunId);
      } catch {
        // Files uploaded but finalization failed — they'll be picked up by recovery
      }
    }

    // Refresh file lists
    queryClient.invalidateQueries({ queryKey: ["uploads", kbId, sourceId] });
    queryClient.invalidateQueries({ queryKey: ["file-stats", kbId, sourceId] });
    queryClient.invalidateQueries({ queryKey: ["source-stats", kbId] });

    // Clear upload statuses after a delay
    setTimeout(() => setUploadingFiles({}), 3000);
  }, [kbId, sourceId, uploadFile, finalizeUploadBatch, queryClient]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-3">
      {/* Existing files */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Files ({fileUploads?.length ?? 0})
        </label>

        {uploadsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading files...
          </div>
        ) : fileUploads && fileUploads.length > 0 ? (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {fileUploads.map((upload) => {
              const chunks = getChunkCount(upload);
              return (
                <div
                  key={upload.id}
                  className="flex items-center gap-2 p-2 rounded-md border border-border bg-background group"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{upload.filename}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{formatFileSize(upload.sizeBytes)}</span>
                      {chunks !== null && <span>{chunks} chunk{chunks !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  {getStatusBadge(upload.status)}
                  {confirmDeleteId === upload.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => deleteMutation.mutate(upload.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? "..." : "Delete"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(upload.id)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete file"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No files uploaded yet.</p>
        )}
      </div>

      {/* Upload more files */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">Add More Files</label>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          }`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop files here or <span className="text-primary font-medium">browse</span>
          </p>
          <p className="text-[11px] text-muted-foreground">PDF, TXT, CSV, MD, DOCX, HTML</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.txt,.csv,.md,.docx,.doc,.html,.htm,.json,.xml"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) handleFiles(files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Upload progress for new files */}
      {Object.keys(uploadingFiles).length > 0 && (
        <div className="space-y-1">
          {Object.entries(uploadingFiles).map(([name, status]) => (
            <div key={name} className="flex items-center gap-2 text-sm">
              {status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              {status === "success" && (
                <svg className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {status === "error" && (
                <svg className="h-3.5 w-3.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span className="truncate text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EditSourceModal({
  editSource,
  setEditSource,
  onClose,
  onEdit,
  updateIsPending,
  kbId,
  uploadFile,
  finalizeUploadBatch,
}: EditSourceModalProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isWeb = editSource.type === "web";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full max-w-lg mx-4 border border-border max-h-[90vh] flex flex-col">
        <form onSubmit={onEdit} className="flex flex-col max-h-[90vh]">
          <div className="p-6 overflow-y-auto flex-1">
            <h2 className="text-lg font-semibold text-foreground">Edit Source</h2>
            <div className="mt-4 space-y-4">
              {/* Name — always shown */}
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

              {/* Web-only fields */}
              {isWeb && (
                <>
                  {/* Crawl Mode */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Crawl Mode</label>
                    <Select
                      value={editSource.mode}
                      onValueChange={(value) =>
                        setEditSource({ ...editSource, mode: value as "single" | "list" | "sitemap" | "domain" })
                      }
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
                      {editSource.mode === "single" && "Scrape a single page only"}
                      {editSource.mode === "list" && "Scrape a specific list of URLs"}
                      {editSource.mode === "sitemap" && "Discover pages from a sitemap.xml"}
                      {editSource.mode === "domain" && "Recursively crawl pages within the domain"}
                    </p>
                    <InfoNote>Changing crawl mode affects how the next re-crawl discovers pages.</InfoNote>
                  </div>

                  {/* URL / URLs */}
                  {editSource.mode === "list" ? (
                    <div>
                      <label className="block text-sm font-medium text-foreground">URLs (one per line)</label>
                      <textarea
                        value={editSource.urls}
                        onChange={(e) => setEditSource({ ...editSource, urls: e.target.value })}
                        className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                        placeholder={"https://docs.example.com/page1\nhttps://docs.example.com/page2"}
                        rows={4}
                        required
                      />
                      <InfoNote>Changing URLs will not affect existing data. New URLs will be fetched on the next crawl.</InfoNote>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-foreground">
                        {editSource.mode === "single" && "URL"}
                        {editSource.mode === "sitemap" && "Sitemap URL"}
                        {editSource.mode === "domain" && "Starting URL"}
                      </label>
                      <input
                        type="url"
                        value={editSource.url}
                        onChange={(e) => setEditSource({ ...editSource, url: e.target.value })}
                        className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                        placeholder={
                          editSource.mode === "sitemap"
                            ? "https://docs.example.com/sitemap.xml"
                            : "https://docs.example.com"
                        }
                        required
                      />
                      <InfoNote>Changing the URL will not affect existing data. The new URL will be used on the next crawl.</InfoNote>
                    </div>
                  )}

                  {/* Max Depth — domain mode only */}
                  {editSource.mode === "domain" && (
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
                      <p className="mt-1 text-xs text-muted-foreground">
                        How many links deep to follow from the starting URL
                      </p>
                    </div>
                  )}

                  {/* Auto-Refresh Schedule */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Auto-Refresh Schedule</label>
                    <Select
                      value={editSource.schedule || "none"}
                      onValueChange={(value) =>
                        setEditSource({ ...editSource, schedule: value === "none" ? null : (value as "daily" | "weekly") })
                      }
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

                  {/* Advanced Settings — collapsible */}
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-0" : "-rotate-90"}`}
                        />
                        Advanced Settings
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 mt-3">
                      {/* Include Patterns */}
                      <div>
                        <label className="block text-sm font-medium text-foreground">Include Patterns</label>
                        <textarea
                          value={editSource.includePatterns}
                          onChange={(e) => setEditSource({ ...editSource, includePatterns: e.target.value })}
                          className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground font-mono focus:border-primary focus:ring-primary"
                          placeholder={"/docs/*\n/blog/*"}
                          rows={3}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Only crawl URLs matching these patterns (one per line). Leave empty to include all.
                        </p>
                      </div>

                      {/* Exclude Patterns */}
                      <div>
                        <label className="block text-sm font-medium text-foreground">Exclude Patterns</label>
                        <textarea
                          value={editSource.excludePatterns}
                          onChange={(e) => setEditSource({ ...editSource, excludePatterns: e.target.value })}
                          className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground font-mono focus:border-primary focus:ring-primary"
                          placeholder={"/admin/*\n/private/*"}
                          rows={3}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Skip URLs matching these patterns (one per line).
                        </p>
                      </div>

                      {/* Include Subdomains */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium text-foreground">Include Subdomains</label>
                          <p className="text-xs text-muted-foreground">Follow links to subdomains of the starting URL</p>
                        </div>
                        <Switch
                          checked={editSource.includeSubdomains}
                          onCheckedChange={(checked) =>
                            setEditSource({ ...editSource, includeSubdomains: checked })
                          }
                        />
                      </div>

                      {/* Respect robots.txt */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium text-foreground">Respect robots.txt</label>
                          <p className="text-xs text-muted-foreground">Honor the site's robots.txt crawl directives</p>
                        </div>
                        <Switch
                          checked={editSource.respectRobotsTxt}
                          onCheckedChange={(checked) =>
                            setEditSource({ ...editSource, respectRobotsTxt: checked })
                          }
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}

              {/* Upload type — file management */}
              {!isWeb && kbId && uploadFile && (
                <UploadFileManager
                  kbId={kbId}
                  sourceId={editSource.id}
                  uploadFile={uploadFile}
                  finalizeUploadBatch={finalizeUploadBatch}
                />
              )}

              {/* Upload type — fallback when props missing */}
              {!isWeb && (!kbId || !uploadFile) && (
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-sm text-muted-foreground">
                    Upload sources can only have their name changed. To update content, upload new files to this source.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="px-6 py-4 bg-muted/50 rounded-b-lg flex justify-end gap-3 border-t border-border shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateIsPending}
            >
              {updateIsPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
