import { useId } from "react";
import { cn } from "@/lib/utils";

const PASS_RATE_LABELS = [100, 75, 50, 25, 0];

const PASS_RATE_ZONES = [
  { label: "Strong", className: "bg-emerald-500/10", min: 80 },
  { label: "Watch", className: "bg-amber-500/10", min: 60 },
  { label: "Risk", className: "bg-rose-500/10", min: 0 },
];

export interface PassRateLinePoint {
  date: string;
  passRate: number;
  totalRuns: number;
}

export const buildPassRateLineSeries = (data: PassRateLinePoint[], maxPoints = 14) =>
  data.slice(-maxPoints).map((point) => {
    const parsedPassRate = Number(point.passRate);
    const normalizedPassRate = Number.isFinite(parsedPassRate) ? parsedPassRate : 0;

    return {
      ...point,
      passRate: Math.max(0, Math.min(100, normalizedPassRate)),
    };
  });

const formatPassRate = (value: number) => `${Math.round(value)}%`;

interface PassRateLineChartProps {
  data: PassRateLinePoint[];
  maxPoints?: number;
  className?: string;
  emptyMessage?: string;
}

export function PassRateLineChart({
  data,
  maxPoints = 14,
  className,
  emptyMessage = "No pass rate data yet",
}: PassRateLineChartProps) {
  const chartId = useId().replace(/:/g, "");
  const fillId = `pass-rate-fill-${chartId}`;

  if (!data.length) {
    return (
      <div className={cn("h-56 flex items-center justify-center text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  const series = buildPassRateLineSeries(data, maxPoints);
  const pointCount = Math.max(series.length - 1, 1);
  const points = series.map((point, index) => {
    const x = (index / pointCount) * 100;
    const y = 100 - (point.passRate / 100) * 100;
    return { ...point, x, y };
  });
  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${polylinePoints} 100,100 0,100`;

  return (
    <div className={cn("h-64", className)}>
      <div className="flex h-48">
        <div className="flex flex-col justify-between text-xs text-muted-foreground pr-2 py-1 w-10">
          {PASS_RATE_LABELS.map((value) => (
            <span key={value} className="text-right">{value}%</span>
          ))}
        </div>

        <div className="flex-1 border-l border-b border-border relative">
          <div className="absolute inset-0 flex flex-col pointer-events-none">
            {PASS_RATE_ZONES.map((zone) => (
              <div key={zone.label} className={cn("flex-1", zone.className)} />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {PASS_RATE_LABELS.map((value) => (
              <div key={value} className="border-t border-border/50 w-full" />
            ))}
          </div>

          <svg
            className="absolute inset-0 z-10 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.24} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <polygon points={areaPoints} fill={`url(#${fillId})`} />
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Render circles as HTML elements to keep them circular */}
          {points.map((point) => (
            <div
              key={`${point.date}-dot`}
              className="absolute w-2.5 h-2.5 rounded-full bg-primary border-2 border-background -translate-x-1/2 -translate-y-1/2 z-20"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            />
          ))}

          {points.map((point) => {
            const runsLabel = `${point.totalRuns} run${point.totalRuns === 1 ? "" : "s"}`;
            // Clamp tooltip position to stay within chart bounds
            const clampedY = Math.max(0, Math.min(100, point.y));
            return (
              <div
                key={`${point.date}-tooltip`}
                className="absolute -translate-x-1/2 -translate-y-1/2 group"
                style={{ left: `${point.x}%`, top: `${clampedY}%` }}
              >
                <div className="h-4 w-4 cursor-pointer" />
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  <div>{new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  <div>{formatPassRate(point.passRate)} pass · {runsLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex ml-10 mt-2 justify-around px-1 overflow-hidden">
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
