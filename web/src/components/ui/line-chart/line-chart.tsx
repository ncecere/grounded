import type { CSSProperties } from "react";
import {
  ChartData,
  ChartLegend,
  chartRuns,
  chartToneClass,
  chartValue,
  seriesName,
  seriesPattern,
  seriesTone,
  type ChartDataOptions,
  type ChartPoint,
  type ChartSeries,
  type ChartTone,
} from "@/components/ui/chart/chart";
import { cx } from "@/lib/bitop-utils";
import styles from "./line-chart.module.css";

/*
 * LineChart: one or more series over an ordered set of points, as lines or
 * filled areas, drawn in SVG (no chart library).
 *
 *   <LineChart
 *     summary="Answers per day, 1–14 Sep: 1,204 in total, rising from 61 to 96."
 *     series={[{ key: "answers", label: "Answers" }, { key: "chats", label: "Conversations" }]}
 *     data={days}                       // [{ label: "Sep 1", values: { answers: 61, chats: 20 } }, …]
 *     variant="area"
 *     dataTable={{ caption: "Answers per day" }}
 *   />
 *
 * To assistive technology the plot is one image named by `summary` (say
 * what the chart shows: the range, the total, the trend and the extremes);
 * `dataTable` adds a "Show data" disclosure with every number in a table.
 * Series differ by colour and line pattern (solid, dashed, dotted). Colours,
 * legend and data table are shared with BarChart (see chart). The scale
 * starts at 0 and tops out at the largest finite value, shown as the peak
 * line. Negative values are drawn at 0 (clamped). NaN and ±Infinity are "no
 * data": left out of the scale, with a gap in the line (a lone point between
 * gaps gets a dot). Titles and the data table show the real values.
 */

export type LineChartTone = ChartTone;
export type LineChartSeries<K extends string = string> = ChartSeries<K>;
export type LineChartPoint<K extends string = string> = ChartPoint<K>;

export type LineChartProps<K extends string = string> = {
  data: LineChartPoint<K>[];
  series: LineChartSeries<K>[];
  /** Text alternative of the whole chart (required). */
  summary: string;
  /** line: strokes only; area: strokes over a soft fill. */
  variant?: "line" | "area";
  size?: "sm" | "md" | "lg";
  /** Formats values for the peak label, hover titles and data table. */
  formatValue?: (value: number) => string;
  /** Show the legend (default true). */
  legend?: boolean;
  /** Show the first and last labels and the peak value (default true). */
  axis?: boolean;
  /** Mark every point with a dot (default: only when there is a single point). */
  points?: boolean;
  /** Adds a "Show data" disclosure with the numbers in a table. */
  dataTable?: ChartDataOptions;
  className?: string;
};

// The plot's coordinate system; the SVG stretches to its box (strokes don't scale).
const W = 1000;
const H = 100;

/** A line or area chart with a legend; role="img" with a text summary and an optional data table. */
export function LineChart<K extends string>({
  data,
  series,
  summary,
  variant = "line",
  size = "md",
  formatValue = (v) => v.toLocaleString(),
  legend = true,
  axis = true,
  points,
  dataTable,
  className,
}: LineChartProps<K>) {
  // Non-finite values (null here) are left out of the scale and drawn as gaps.
  const values = series.map((s) => data.map((p) => chartValue(p, s.key)));
  const peak = Math.max(0, ...values.flatMap((vs) => vs.map((v) => v ?? 0)));
  const n = data.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => (peak > 0 ? H - (Math.max(0, v) / peak) * H : H);
  const xy = (i: number, v: number) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  const showPoints = points ?? n === 1;
  const runs = values.map((vs) => chartRuns(vs));
  const describe = (s: LineChartSeries<K>, v: number | null) => (v === null ? `${seriesName(s)}: no data` : `${formatValue(v)} ${seriesName(s)}`);

  return (
    <figure className={cx(styles.root, className)} data-size={size} data-variant={variant}>
      {legend && <ChartLegend series={series} swatch={variant === "area" ? "square" : "line"} />}
      <div className={styles.plot} role="img" aria-label={summary}>
        {axis && <span className={styles.peak}>{formatValue(peak)}</span>}
        <div className={styles.area}>
          <svg aria-hidden focusable="false" className={styles.svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {n > 1 &&
              series.map((s, i) => {
                // One subpath per run of points with data, so missing values leave gaps.
                const line = runs[i]!.map((run) => run.map(([j, v], k) => `${k === 0 ? "M" : "L"}${xy(j, v)}`).join(" ")).join(" ");
                const fill = runs[i]!
                  .filter((run) => run.length > 1)
                  .map((run) => `M${x(run[0]![0]).toFixed(2)},${H} ${run.map(([j, v]) => `L${xy(j, v)}`).join(" ")} L${x(run[run.length - 1]![0]).toFixed(2)},${H} Z`)
                  .join(" ");
                if (!line) return null;
                return (
                  <g key={s.key} className={chartToneClass} data-tone={seriesTone(s, i)}>
                    {variant === "area" && fill && <path className={styles.fill} d={fill} />}
                    <path className={styles.line} data-pattern={seriesPattern(s, i)} d={line} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
          </svg>
          {series.map((s, i) =>
            data.map((_p, j) => {
              const v = values[i]![j]!;
              // Dots on every point when asked, and on lone points between gaps (no line to show them).
              const lone = n > 1 && runs[i]!.some((run) => run.length === 1 && run[0]![0] === j);
              if (v === null || !(showPoints || lone)) return null;
              return (
                <span
                  key={`${s.key}-${j}`}
                  aria-hidden
                  className={cx(chartToneClass, styles.point)}
                  data-tone={seriesTone(s, i)}
                  style={{ "--x": `${(x(j) / W) * 100}%`, "--y": `${(y(v) / H) * 100}%` } as CSSProperties}
                />
              );
            }),
          )}
          {/* Hover targets: one column per point with its values as a title. */}
          <div className={styles.slots}>
            {data.map((p, j) => (
              <span key={j} className={styles.slot} title={`${p.label}: ${series.map((s, i) => describe(s, values[i]![j]!)).join(", ")}`} />
            ))}
          </div>
        </div>
      </div>
      {axis && n > 0 && (
        <div aria-hidden className={styles.axis}>
          <span>{data[0]!.label}</span>
          {n > 1 && <span>{data[n - 1]!.label}</span>}
        </div>
      )}
      {dataTable && (
        <ChartData
          caption={dataTable.caption}
          labelHeader={dataTable.labelHeader}
          defaultOpen={dataTable.defaultOpen}
          series={series}
          data={data}
          formatValue={formatValue}
        />
      )}
    </figure>
  );
}
