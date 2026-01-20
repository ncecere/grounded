import { ArrowDownRight, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export interface RecentRegressionRow {
  runId: string;
  suiteId: string;
  suiteName: string;
  agentId: string;
  agentName: string;
  previousPassRate: number;
  currentPassRate: number;
  failedAt: string;
}

interface RecentRegressionsTableProps {
  data: RecentRegressionRow[];
  isLoading?: boolean;
  onSelectRun?: (regression: RecentRegressionRow) => void;
  className?: string;
}

const clampPassRate = (value: number) => Math.max(0, Math.min(100, value));

const formatPassRate = (value: number) => `${Math.round(clampPassRate(value))}%`;

export const formatPassRateChange = (previous: number, current: number) =>
  `${formatPassRate(previous)} → ${formatPassRate(current)}`;

export const formatRelativeTime = (value: string | null, now: Date = new Date()) => {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  const diffSeconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: "year", seconds: 60 * 60 * 24 * 365 },
    { unit: "month", seconds: 60 * 60 * 24 * 30 },
    { unit: "day", seconds: 60 * 60 * 24 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "minute", seconds: 60 },
    { unit: "second", seconds: 1 },
  ];

  const { unit, seconds } =
    units.find((entry) => Math.abs(diffSeconds) >= entry.seconds) ?? units[units.length - 1];

  const valueForUnit = Math.round(diffSeconds / seconds);
  return formatter.format(valueForUnit, unit);
};

export function RecentRegressionsTable({
  data,
  isLoading = false,
  onSelectRun,
  className,
}: RecentRegressionsTableProps) {
  if (isLoading) {
    return <LoadingSkeleton variant="table" className={className} />;
  }

  if (data.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card", className)}>
        <EmptyState
          icon={TrendingDown}
          title="No regressions detected"
          description="Recent agent test runs have held steady."
        />
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="min-w-[220px]">Agent / Suite</TableHead>
            <TableHead className="min-w-[160px]">Pass rate change</TableHead>
            <TableHead className="min-w-[140px]">When</TableHead>
            <TableHead className="text-right">Run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const delta = row.currentPassRate - row.previousPassRate;
            const deltaLabel = `${delta > 0 ? "+" : ""}${Math.round(delta)}%`;

            return (
              <TableRow key={row.runId}>
                <TableCell>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-foreground">{row.agentName}</div>
                    <div className="text-xs text-muted-foreground">{row.suiteName}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-destructive">
                      {formatPassRateChange(row.previousPassRate, row.currentPassRate)}
                    </div>
                    <div className="inline-flex items-center gap-1 text-xs text-destructive">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      {deltaLabel}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-foreground">{formatRelativeTime(row.failedAt)}</div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectRun?.(row)}
                    disabled={!onSelectRun}
                  >
                    View run
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
