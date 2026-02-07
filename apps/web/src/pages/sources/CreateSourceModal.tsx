import { useState, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Button } from "@/components/ui/button";
import { SUPPORTED_FORMATS, ACCEPTED_FILE_TYPES } from "./source-utils";

interface NewSourceForm {
  name: string;
  type: "web" | "upload";
  mode: "single" | "list" | "sitemap" | "domain";
  url: string;
  urls: string;
  depth: number;
  schedule: "daily" | "weekly" | null;
}

interface CreateSourceModalProps {
  newSource: NewSourceForm;
  setNewSource: (value: NewSourceForm | ((prev: NewSourceForm) => NewSourceForm)) => void;
  onClose: () => void;
  onCreate: (e: React.FormEvent) => void;
  onUploadFiles: () => void;
  createIsPending: boolean;
  kbId: string;
  uploadFile: (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string }) => Promise<unknown>;
}

export function CreateSourceModal({
  newSource,
  setNewSource,
  onClose,
  onCreate,
  onUploadFiles,
  createIsPending,
}: CreateSourceModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, "pending" | "uploading" | "success" | "error">>({});
  const [isDragging, setIsDragging] = useState(false);

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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 border border-border">
        <form onSubmit={onCreate}>
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
                setSelectedFiles([]);
                setUploadProgress({});
                onClose();
              }}
            >
              Cancel
            </Button>
            {newSource.type === "upload" ? (
              <Button
                type="button"
                onClick={onUploadFiles}
                disabled={selectedFiles.length === 0 || Object.values(uploadProgress).some((s) => s === "uploading")}
              >
                {Object.values(uploadProgress).some((s) => s === "uploading")
                  ? "Uploading..."
                  : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? "s" : ""}`}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={createIsPending}
              >
                {createIsPending ? "Creating..." : "Create"}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
