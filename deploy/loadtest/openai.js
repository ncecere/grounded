// (c) The OpenAI-compatible endpoint, non-streaming: POST
// /v1/chat/completions with model agent:{team}/{slug} and a service key,
// at increasing concurrency. Stateless (no transcript is stored).
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { bearer, levels, list, loadInstall, question, rng, seconds } from './lib/common.js';
import { output, table, thresholds, trendStats } from './lib/summary.js';

const install = loadInstall();
const LEVELS = list('LEVELS', '10,25,50,100');
const HOLD = __ENV.HOLD || '60s';

const latency = new Trend('openai_latency', true);
const errors = new Rate('openai_errors');
const done = new Counter('openai_done');

// Each level ramps up over RAMP (people do not all press Enter in the same
// second), then holds. RAMP=0s measures the burst instead.
const RAMP = __ENV.RAMP || '10s';
const scen = levels(LEVELS, `${seconds(RAMP) + seconds(HOLD)}s`, '15s', (n) => `o${n}`, (n) => ({
  executor: 'ramping-vus', startVUs: 0, stages: [{ duration: RAMP, target: n }, { duration: HOLD, target: n }],
}));

export const options = {
  scenarios: scen,
  summaryTrendStats: trendStats,
  thresholds: thresholds(Object.keys(scen), { openai_latency: 'trend', openai_errors: 'rate', openai_done: 'counter' }, {
    openai_errors: () => ['rate<0.01'],
  }),
};

const r = rng(Number(__ENV.SEED || 3) + __VU * 15485863);

export default function () {
  const res = http.post(`${install.baseUrl}/v1/chat/completions`, JSON.stringify({
    model: install.openaiModel, stream: false, messages: [{ role: 'user', content: question(r) }],
  }), { headers: bearer(install.serviceKey), timeout: '180s', tags: { name: 'openai' } });
  const ok = check(res, {
    'openai 200': (x) => x.status === 200,
    'openai content': (x) => x.status === 200 && String(x.json('choices.0.message.content') || '').length > 0,
  });
  errors.add(!ok);
  if (!ok) {
    if (res.status !== 200) console.warn(`openai ${res.status}: ${String(res.body).slice(0, 200)}`);
    return;
  }
  latency.add(res.timings.duration);
  done.add(1);
}

export function handleSummary(data) {
  const rows = LEVELS.map((n) => ({ name: `o${n}`, label: `${n} concurrent`, seconds: seconds(HOLD) + seconds(RAMP) / 2 }));
  return output('openai', data, table(data, 'OpenAI-compatible /v1/chat/completions (non-streaming)', rows, [
    { title: 'completions', metric: 'openai_done', stat: 'count' },
    { title: 'per second', metric: 'openai_done', stat: 'perSecond' },
    { title: 'p50', metric: 'openai_latency', stat: 'p(50)', unit: 'ms' },
    { title: 'p95', metric: 'openai_latency', stat: 'p(95)', unit: 'ms' },
    { title: 'p99', metric: 'openai_latency', stat: 'p(99)', unit: 'ms' },
    { title: 'errors', metric: 'openai_errors', stat: 'rate', unit: '%' },
  ]));
}
