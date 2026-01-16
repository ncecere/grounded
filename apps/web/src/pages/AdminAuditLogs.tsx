import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AuditLogEntry, type AuditAction, type AuditResourceType } from "../lib/api";
import {
  Shield,
  User,
  Bot,
  Database,
  FileText,
  Key,
  Settings,
  Server,
  Search,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  XCircle,
  Filter,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

// Helper to get icon for resource type
function getResourceIcon(resourceType: AuditResourceType) {
  switch (resourceType) {
    case "user":
      return User;
    case "tenant":
      return Shield;
    case "agent":
      return Bot;
    case "knowledge_base":
      return Database;
    case "source":
      return FileText;
    case "api_key":
    case "widget_token":
    case "chat_endpoint":
      return Key;
    case "settings":
      return Settings;
    case "model":
    case "provider":
      return Server;
    default:
      return FileText;
  }
}

// Helper to get action display text
function formatAction(action: AuditAction): string {
  return action
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/_/g, " "))
    .join(" - ");
}

// Helper to get action color
function getActionColor(action: AuditAction): string {
  if (action.includes("created")) return "text-green-600 dark:text-green-400";
  if (action.includes("deleted") || action.includes("revoked")) return "text-red-600 dark:text-red-400";
  if (action.includes("updated") || action.includes("changed")) return "text-blue-600 dark:text-blue-400";
  if (action.includes("failed")) return "text-red-600 dark:text-red-400";
  if (action.includes("login") || action.includes("logout")) return "text-purple-600 dark:text-purple-400";
  return "text-muted-foreground";
}

// Expandable log entry component
function AuditLogItem({
  log,
}: {
  log: AuditLogEntry & { actorEmail: string | null; tenantName: string | null };
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = getResourceIcon(log.resourceType);

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Expand/collapse indicator */}
        <div className="mt-0.5 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>

        {/* Icon */}
        <div className="p-1.5 rounded-lg bg-muted">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-sm ${getActionColor(log.action)}`}>
              {formatAction(log.action)}
            </span>
            {!log.success && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-red-500/15 text-red-700 dark:text-red-400 rounded">
                <XCircle className="w-3 h-3" />
                Failed
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{log.actorEmail || "System"}</span>
            {log.tenantName && (
              <>
                <span className="text-muted-foreground/50">•</span>
                <span>{log.tenantName}</span>
              </>
            )}
            {typeof log.metadata?.resourceName === "string" && (
              <>
                <span className="text-muted-foreground/50">•</span>
                <span className="font-mono text-xs">{log.metadata.resourceName as string}</span>
              </>
            )}
          </div>
        </div>

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(log.timestamp).toLocaleString()}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 pl-14 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Resource Type</div>
              <div className="font-medium capitalize">{log.resourceType.replace(/_/g, " ")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Resource ID</div>
              <div className="font-mono text-xs">{log.resourceId || "N/A"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">IP Address</div>
              <div className="font-mono text-xs">{log.ipAddress || "N/A"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <div className="flex items-center gap-1">
                {log.success ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-green-600">Success</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span className="text-red-600">Failed</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {log.errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Error</span>
              </div>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{log.errorMessage}</p>
            </div>
          )}

          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Metadata</div>
              <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminAuditLogs() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Fetch filter options
  const { data: filters } = useQuery({
    queryKey: ["audit-filters"],
    queryFn: api.getAuditLogFilters,
  });

  // Fetch audit logs
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "admin-audit-logs",
      { search, actionFilter, resourceTypeFilter, tenantFilter, page },
    ],
    queryFn: () =>
      api.listAuditLogs({
        search: search || undefined,
        action: actionFilter !== "all" ? actionFilter : undefined,
        resourceType: resourceTypeFilter !== "all" ? resourceTypeFilter : undefined,
        tenantId: tenantFilter !== "all" ? tenantFilter : undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
  });

  const hasActiveFilters =
    search || actionFilter !== "all" || resourceTypeFilter !== "all" || tenantFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setActionFilter("all");
    setResourceTypeFilter("all");
    setTenantFilter("all");
    setPage(0);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="table" count={10} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Audit Logs"
        description="Track all system activity and changes"
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>

            {/* Action filter */}
            <Select
              value={actionFilter}
              onValueChange={(value) => {
                setActionFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {filters?.actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {formatAction(action as AuditAction)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Resource type filter */}
            <Select
              value={resourceTypeFilter}
              onValueChange={(value) => {
                setResourceTypeFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All resources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                {filters?.resourceTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, " ").charAt(0).toUpperCase() +
                      type.replace(/_/g, " ").slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Tenant filter */}
            <Select
              value={tenantFilter}
              onValueChange={(value) => {
                setTenantFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tenants</SelectItem>
                {filters?.tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Active filters summary */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              <span>
                Showing {data?.logs.length || 0} of {data?.total || 0} logs
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logs list */}
      <Card>
        <div className="divide-y divide-border">
          {data?.logs.length === 0 ? (
            <div className="p-12 text-center">
              <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground">No logs found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "Audit logs will appear here as actions are performed"}
              </p>
            </div>
          ) : (
            data?.logs.map((log) => <AuditLogItem key={log.id} log={log} />)
          )}
        </div>

        {/* Pagination */}
        {data && data.total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1} to{" "}
              {Math.min((page + 1) * pageSize, data.total)} of {data.total} logs
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isFetching}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.hasMore || isFetching}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
