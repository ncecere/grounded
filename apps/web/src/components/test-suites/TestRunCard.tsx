import { Clock, Timer, UserCircle } from "lucide-react";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { StatusBadge, type StatusType } from "../ui/status-badge";
import type { TestSuiteRun } from "../../lib/api";

export const formatRunDuration = (durationMs: number | null) => {
  if (!durationMs || durationMs <= 0) {
    return "-";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

export const formatRunTimingLabel = (run: TestSuiteRun) => {
  if (run.completedAt) {
    return `Completed ${new Date(run.completedAt).toLocaleDateString("en-US")}`;
  }

  if (run.startedAt) {
    return `Started ${new Date(run.startedAt).toLocaleDateString("en-US")}`;
  }

  return "Not started";
};

export const formatRunTriggerLabel = (run: TestSuiteRun) => {
  if (run.triggeredBy === "schedule") {
    return "Scheduled run";
  }

  const userName = run.triggeredByUser?.name;
  if (userName) {
    return `Manual run by ${userName}`;
  }

  return "Manual run";
};

export const getRunStatusBadge = (run: TestSuiteRun): { status: StatusType; label: string } => {
  switch (run.status) {
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
      return { status: "default", label: "Unknown" };
  }
};

interface TestRunCardProps {
  run: TestSuiteRun;
  onOpen: (run: TestSuiteRun) => void;
}

export function TestRunCard({ run, onOpen }: TestRunCardProps) {
  const statusBadge = getRunStatusBadge(run);
  const durationLabel = formatRunDuration(run.durationMs);
  const timingLabel = formatRunTimingLabel(run);
  const triggerLabel = formatRunTriggerLabel(run);
  const passRateValue = Math.min(100, Math.max(0, Math.round(run.passRate)));

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm cursor-pointer"
      onClick={() => onOpen(run)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">{run.suiteName}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              {run.triggeredBy === "schedule" ? "Schedule" : "Manual"}
            </Badge>
            <span className="inline-flex items-center gap-1">
              <UserCircle className="h-3.5 w-3.5" />
              {triggerLabel}
            </span>
          </div>
        </div>
        <StatusBadge status={statusBadge.status} label={statusBadge.label} />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Pass rate</span>
          <span className="font-medium text-foreground">{passRateValue}%</span>
        </div>
        <Progress value={passRateValue} className="h-2" />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        <div className="rounded-md border border-border bg-muted/20 px-2 py-2 text-center">
          <p className="text-muted-foreground">Total</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">{run.totalCases}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2 py-2 text-center">
          <p className="text-muted-foreground">Passed</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">{run.passedCases}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2 py-2 text-center">
          <p className="text-muted-foreground">Failed</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">{run.failedCases}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-2 py-2 text-center">
          <p className="text-muted-foreground">Skipped</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">{run.skippedCases}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {timingLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" />
          {durationLabel}
        </span>
      </div>
    </div>
  );
}
