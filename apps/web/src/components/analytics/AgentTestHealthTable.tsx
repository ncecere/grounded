import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, type StatusType } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

type TrendDirection = "up" | "down" | "stable" | "unknown";
type SortKey = "agent" | "suiteCount" | "caseCount" | "passRate" | "lastRunAt" | "status";
type SortDirection = "asc" | "desc";

export interface AgentTestHealthRow {
  agentId: string;
  agentName: string;
  suiteCount: number;
  caseCount: number;
  passRate: number | null;
  passRateChange: number | null;
  lastRunAt: string | null;
  lastRunStatus: "pending" | "running" | "completed" | "failed" | "cancelled" | null;
}

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

interface AgentTestHealthTableProps {
  data: AgentTestHealthRow[];
  isLoading?: boolean;
  onSelectAgent?: (agentId: string) => void;
  className?: string;
}

const DEFAULT_SORT: SortConfig = { key: "passRate", direction: "desc" };
const TREND_THRESHOLD = 0.5;
const collator = new Intl.Collator("en", { sensitivity: "base" });

const getPassRateTrend = (change: number | null, threshold = TREND_THRESHOLD): TrendDirection => {
  if (change === null || Number.isNaN(change)) {
    return "unknown";
  }

  if (Math.abs(change) < threshold) {
    return "stable";
  }

  return change > 0 ? "up" : "down";
};

const formatPassRate = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)}%`;
};

const formatChange = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  const rounded = Math.round(value * 10) / 10;
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded}%`;
};

const formatLastRun = (value: string | null) => {
  if (!value) {
    return "No runs";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const getStatusBadge = (status: AgentTestHealthRow["lastRunStatus"]): { status: StatusType; label: string } => {
  switch (status) {
    case "pending":
      return { status: "pending", label: "Queued" };
    case "running":
      return { status: "pending", label: "Running" };
    case "completed":
      return { status: "success", label: "Completed" };
    case "failed":
      return { status: "error", label: "Failed" };
    case "cancelled":
      return { status: "warning", label: "Cancelled" };
    default:
      return { status: "inactive", label: "No runs" };
  }
};

const statusSortOrder: Record<NonNullable<AgentTestHealthRow["lastRunStatus"]> | "none", number> = {
  running: 0,
  pending: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
  none: 5,
};

const getSortValue = (row: AgentTestHealthRow, key: SortKey) => {
  switch (key) {
    case "agent":
      return row.agentName;
    case "suiteCount":
      return row.suiteCount;
    case "caseCount":
      return row.caseCount;
    case "passRate":
      return row.passRate ?? -1;
    case "lastRunAt":
      return row.lastRunAt ? new Date(row.lastRunAt).getTime() : -1;
    case "status":
      return statusSortOrder[row.lastRunStatus ?? "none"] ?? statusSortOrder.none;
    default:
      return row.agentName;
  }
};

export const sortAgentTestHealthRows = (rows: AgentTestHealthRow[], sort: SortConfig) => {
  const sorted = [...rows].sort((a, b) => {
    const aValue = getSortValue(a, sort.key);
    const bValue = getSortValue(b, sort.key);
    let comparison = 0;

    if (typeof aValue === "string" && typeof bValue === "string") {
      comparison = collator.compare(aValue, bValue);
    } else {
      comparison = (aValue as number) - (bValue as number);
    }

    if (comparison === 0) {
      comparison = collator.compare(a.agentName, b.agentName);
    }

    return sort.direction === "asc" ? comparison : -comparison;
  });

  return sorted;
};

export function AgentTestHealthTable({
  data,
  isLoading = false,
  onSelectAgent,
  className,
}: AgentTestHealthTableProps) {
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const sortedData = useMemo(() => sortAgentTestHealthRows(data, sort), [data, sort]);

  if (isLoading) {
    return <LoadingSkeleton variant="table" className={className} />;
  }

  if (data.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card", className)}>
        <EmptyState
          icon={FlaskConical}
          title="No agent test activity"
          description="Run agent test suites to populate health metrics."
        />
      </div>
    );
  }

  const handleSort = (key: SortKey) => {
    setSort((current) => {
      if (current.key === key) {
        return { ...current, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      const defaultDirection: SortDirection = key === "agent" || key === "status" ? "asc" : "desc";
      return { key, direction: defaultDirection };
    });
  };

  const renderSortIcon = (key: SortKey) => {
    if (sort.key !== key) {
      return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    }

    return sort.direction === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
    );
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="min-w-[200px]">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("agent")}>
                <span>Agent</span>
                {renderSortIcon("agent")}
              </Button>
            </TableHead>
            <TableHead className="text-right">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("suiteCount")}>
                <span>Suites</span>
                {renderSortIcon("suiteCount")}
              </Button>
            </TableHead>
            <TableHead className="text-right">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("caseCount")}>
                <span>Cases</span>
                {renderSortIcon("caseCount")}
              </Button>
            </TableHead>
            <TableHead className="min-w-[200px]">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("passRate")}>
                <span>Pass rate</span>
                {renderSortIcon("passRate")}
              </Button>
            </TableHead>
            <TableHead className="min-w-[180px]">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("lastRunAt")}>
                <span>Last run</span>
                {renderSortIcon("lastRunAt")}
              </Button>
            </TableHead>
            <TableHead className="min-w-[140px]">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleSort("status")}>
                <span>Status</span>
                {renderSortIcon("status")}
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.map((row) => {
            const passRateValue = row.passRate === null ? null : Math.max(0, Math.min(100, row.passRate));
            const trend = getPassRateTrend(row.passRateChange);
            const statusBadge = getStatusBadge(row.lastRunStatus);

            return (
              <TableRow key={row.agentId}>
                <TableCell>
                  {onSelectAgent ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="px-0 text-left"
                      onClick={() => onSelectAgent(row.agentId)}
                    >
                      {row.agentName}
                    </Button>
                  ) : (
                    <span className="text-sm font-medium text-foreground">{row.agentName}</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{row.suiteCount}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{row.caseCount}</TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{formatPassRate(passRateValue)}</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs",
                          trend === "up" && "text-success",
                          trend === "down" && "text-destructive",
                          trend === "stable" && "text-muted-foreground",
                          trend === "unknown" && "text-muted-foreground"
                        )}
                      >
                        {trend === "up" && <ArrowUpRight className="h-3.5 w-3.5" />}
                        {trend === "down" && <ArrowDownRight className="h-3.5 w-3.5" />}
                        {trend === "stable" && <Minus className="h-3.5 w-3.5" />}
                        {formatChange(row.passRateChange)}
                      </span>
                    </div>
                    {passRateValue !== null && <Progress value={passRateValue} className="h-2" />}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-foreground">{formatLastRun(row.lastRunAt)}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={statusBadge.status} label={statusBadge.label} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export { getPassRateTrend, formatLastRun };
