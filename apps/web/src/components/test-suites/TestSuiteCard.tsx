import { CalendarClock, Eye, ListChecks, Play, Settings, Trash2, Clock } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge, type StatusType } from "../ui/status-badge";
import type { TestSuite, TestSuiteRunSummary } from "../../lib/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const formatPassRate = (passRate: number) => {
  const normalized = Math.min(100, Math.max(0, Math.round(passRate)));
  return `${normalized}%`;
};

export const getScheduleLabel = (suite: TestSuite) => {
  const timeLabel = suite.scheduleTime ?? null;
  const dayLabel = suite.scheduleDayOfWeek != null ? WEEKDAY_LABELS[suite.scheduleDayOfWeek] : null;

  switch (suite.scheduleType) {
    case "manual":
      return "Manual";
    case "hourly":
      return "Hourly";
    case "daily":
      return timeLabel ? `Daily · ${timeLabel}` : "Daily";
    case "weekly":
      if (dayLabel && timeLabel) {
        return `Weekly · ${dayLabel} ${timeLabel}`;
      }
      if (dayLabel) {
        return `Weekly · ${dayLabel}`;
      }
      if (timeLabel) {
        return `Weekly · ${timeLabel}`;
      }
      return "Weekly";
    default:
      return "Manual";
  }
};

export const getRunStatusBadge = (lastRun: TestSuiteRunSummary | null): {
  status: StatusType;
  label: string;
} => {
  if (!lastRun) {
    return { status: "default", label: "No runs" };
  }

  switch (lastRun.status) {
    case "pending":
      return { status: "pending", label: "Queued" };
    case "running":
      return { status: "pending", label: "Running" };
    case "completed":
      return { status: "success", label: `Pass ${formatPassRate(lastRun.passRate)}` };
    case "failed":
      return { status: "error", label: "Failed" };
    case "cancelled":
      return { status: "warning", label: "Cancelled" };
    default:
      return { status: "default", label: "Unknown" };
  }
};

export const getRunTimestampLabel = (lastRun: TestSuiteRunSummary | null) => {
  if (!lastRun) {
    return "Not run yet";
  }

  if (lastRun.completedAt) {
    return `Last run ${new Date(lastRun.completedAt).toLocaleDateString("en-US")}`;
  }

  if (lastRun.status === "running") {
    return "Run in progress";
  }

  if (lastRun.status === "pending") {
    return "Run queued";
  }

  return "Run cancelled";
};

interface TestSuiteCardProps {
  suite: TestSuite;
  onOpen: (suite: TestSuite) => void;
  onRun: (suite: TestSuite) => void;
  onEdit: (suite: TestSuite) => void;
  onDelete: (suite: TestSuite) => void;
  onView?: (suite: TestSuite) => void;
}

export function TestSuiteCard({ suite, onOpen, onRun, onEdit, onDelete, onView }: TestSuiteCardProps) {
  const runStatus = getRunStatusBadge(suite.lastRun);
  const runTimestamp = getRunTimestampLabel(suite.lastRun);
  const scheduleLabel = getScheduleLabel(suite);
  const testCaseCount = suite.testCaseCount ?? 0;

  return (
    <div
      className="group relative bg-card rounded-lg border p-5 transition-all cursor-pointer flex flex-col min-h-[180px] border-border hover:border-primary/50 hover:shadow-md"
      onClick={() => onOpen(suite)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground truncate">{suite.name}</h3>
          {suite.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {suite.description}
            </p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0 inline-flex items-center gap-1 text-xs">
          <CalendarClock className="w-3.5 h-3.5" />
          {scheduleLabel}
        </Badge>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ListChecks className="w-4 h-4" />
          {testCaseCount} test case{testCaseCount === 1 ? "" : "s"}
        </span>
        <StatusBadge status={runStatus.status} label={runStatus.label} />
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/60">
        <Clock className="w-3.5 h-3.5" />
        <span>{runTimestamp}</span>
      </div>

      <div
        className="absolute inset-0 rounded-lg bg-background/95 backdrop-blur-sm flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {onView && (
          <Button variant="default" size="sm" onClick={() => onView(suite)} className="gap-1.5">
            <Eye className="w-4 h-4" />
            View
          </Button>
        )}
        <Button variant={onView ? "secondary" : "default"} size="sm" onClick={() => onRun(suite)} className="gap-1.5">
          <Play className="w-4 h-4" />
          Run
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onEdit(suite)} className="gap-1.5">
          <Settings className="w-4 h-4" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(suite)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
