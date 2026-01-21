import { cn } from "@/lib/utils";
import type { TestSuiteRunAnalytics } from "@/lib/api";
import { formatPassRate } from "./TestSuiteCard";

const PASS_RATE_LABELS = [100, 75, 50, 25, 0];

export interface PassRateChartPoint {
  date: string;
  passRate: number;
  totalRuns: number;
  isRegression: boolean;
}

const clampPassRate = (value: number) => Math.max(0, Math.min(100, value));

export const buildPassRateSeries = (
  runs: TestSuiteRunAnalytics["runs"],
  maxPoints = 12
): PassRateChartPoint[] => {
  const trimmed = runs.slice(-maxPoints);

  return trimmed.map((run, index) => {
    const passRate = clampPassRate(run.passRate);
    const previous = index > 0 ? clampPassRate(trimmed[index - 1].passRate) : null;

    return {
      date: run.date,
      passRate,
      totalRuns: run.totalRuns,
      isRegression: previous !== null && passRate < previous,
    };
  });
};

interface PassRateChartProps {
  runs: TestSuiteRunAnalytics["runs"];
  maxPoints?: number;
  className?: string;
  emptyMessage?: string;
}

export function PassRateChart({
  runs,
  maxPoints = 12,
  className,
  emptyMessage = "No pass rate data yet",
}: PassRateChartProps) {
  if (!runs.length) {
    return (
      <div className={cn("h-48 flex items-center justify-center text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  const series = buildPassRateSeries(runs, maxPoints);
  const pointCount = Math.max(series.length - 1, 1);
  const points = series.map((point, index) => {
    const x = (index / pointCount) * 100;
    const y = 100 - (point.passRate / 100) * 100;
    return {
      ...point,
      x,
      y,
    };
  });

  return (
    <div className={cn("h-56", className)}>
      <div className="flex h-44">
        <div className="flex flex-col justify-between text-xs text-muted-foreground pr-2 py-1 w-10">
          {PASS_RATE_LABELS.map((value) => (
            <span key={value} className="text-right">{value}%</span>
          ))}
        </div>

        <div className="flex-1 border-l border-b border-border relative overflow-hidden">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {PASS_RATE_LABELS.map((value) => (
              <div key={value} className="border-t border-border/50 w-full" />
            ))}
          </div>

          <svg className="absolute inset-0" viewBox="0 0 100 100" preserveAspectRatio="none">
            {points.slice(1).map((point, index) => {
              const previous = points[index];
              const strokeClass = point.isRegression ? "stroke-destructive" : "stroke-primary";
              return (
                <line
                  key={`${previous.date}-${point.date}`}
                  x1={previous.x}
                  y1={previous.y}
                  x2={point.x}
                  y2={point.y}
                  className={strokeClass}
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {points.map((point) => {
            const runLabel = `${point.totalRuns} run${point.totalRuns === 1 ? "" : "s"}`;
            const tooltipLabel = `${formatPassRate(point.passRate)} pass · ${runLabel}`;
            return (
              <div
                key={`${point.date}-tooltip`}
                className="absolute -translate-x-1/2 -translate-y-1/2 group"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full border border-background shadow-sm",
                  point.isRegression ? "bg-destructive" : "bg-primary"
                )}
              />
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  <div>{new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  <div className={point.isRegression ? "text-destructive" : "text-foreground"}>
                    {tooltipLabel}
                  </div>
                  {point.isRegression && <div className="text-destructive">Regression</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex ml-10 mt-1 justify-around px-1 overflow-hidden">
        {series.map((point) => (
          <div key={`${point.date}-label`} className="flex-1 text-center">
            <span className="text-xs text-muted-foreground">
              {new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
