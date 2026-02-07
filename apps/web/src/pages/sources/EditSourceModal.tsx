import { useState } from "react";
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
import { ChevronDown, Info } from "lucide-react";

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
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-1.5 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700 dark:text-amber-300">{children}</p>
    </div>
  );
}

export function EditSourceModal({
  editSource,
  setEditSource,
  onClose,
  onEdit,
  updateIsPending,
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

              {/* Upload type — name only, show info */}
              {!isWeb && (
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
