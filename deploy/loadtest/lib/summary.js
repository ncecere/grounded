// End-of-test output: a Markdown table per scenario (one row per load
// level) on stdout and in /results/<name>.md, and k6's full summary in
// /results/<name>.json.
//
// k6 only reports per-scenario sub-metrics that a threshold names, so
// thresholds() adds a threshold for every (metric, scenario) pair: the
// given limits where set, otherwise an always-true one that only makes the
// sub-metric visible.

// thresholds(scenarioNames, metrics, limits): metrics maps a metric name to
// its kind ('trend' | 'rate' | 'counter'); limits maps a metric name to a
// function (scenarioName) -> array of threshold expressions, or undefined.
export function thresholds(scenarios, metrics, limits) {
  const out = {};
  for (const s of scenarios) {
    for (const [m, kind] of Object.entries(metrics)) {
      const lim = limits && limits[m] ? limits[m](s) : undefined;
      const always = { trend: ['max>=0'], rate: ['rate>=0'], counter: ['count>=0'] }[kind];
      out[`${m}{scenario:${s}}`] = lim && lim.length ? lim : always;
    }
  }
  return out;
}

const fmt = (v, unit) => {
  if (v === undefined || v === null || Number.isNaN(v)) return '–';
  if (unit === 'ms') return v >= 10000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
  if (unit === '%') return `${(v * 100).toFixed(2)} %`;
  if (unit === '/s') return v.toFixed(1);
  return String(Math.round(v));
};

// table renders rows for scenarios; columns is a list of
// {title, metric, stat ('p(50)', 'p(95)', 'rate', 'count', 'perSecond'), unit}.
// perSecond divides a counter's count by the scenario's hold seconds.
export function table(data, title, scenarios, columns) {
  const lines = [`### ${title}`, '', `| level | ${columns.map((c) => c.title).join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`];
  for (const s of scenarios) {
    const cells = columns.map((c) => {
      const m = data.metrics[`${c.metric}{scenario:${s.name}}`];
      if (!m) return '–';
      const v = m.values;
      if (c.stat === 'perSecond') return fmt(v.count / s.seconds, '/s');
      if (c.stat === 'p(50)') return fmt(v.med, c.unit);
      return fmt(v[c.stat], c.unit);
    });
    lines.push(`| ${s.label} | ${cells.join(' | ')} |`);
  }
  const failed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([k]) => k);
  lines.push('', failed.length ? `Thresholds failed: ${failed.join(', ')}` : 'All thresholds passed.', '');
  return lines.join('\n');
}

export function output(name, data, markdown) {
  return {
    stdout: `\n${markdown}\n`,
    [`/results/${name}.md`]: markdown,
    [`/results/${name}.json`]: JSON.stringify(data, null, 2),
  };
}

export const trendStats = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'];
