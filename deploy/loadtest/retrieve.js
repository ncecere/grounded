// (b) Retrieval: POST /v1/teams/{team}/kbs/{kb}/retrieve (hybrid search,
// topK 10) with a service key, at fixed arrival rates (requests per second),
// one level after the other.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { bearer, levels, list, loadInstall, question, rng, seconds } from './lib/common.js';
import { output, table, thresholds, trendStats } from './lib/summary.js';

const install = loadInstall();
const LEVELS = list('LEVELS', '10,25,50,100,200');
const HOLD = __ENV.HOLD || '45s';
// DESIGN §1 sizing, doubled: 40,000 queries a day, a peak of about 5/s.
const P95_MS = Number(__ENV.RETRIEVE_P95_MS || 300);
const P95_UP_TO = Number(__ENV.RETRIEVE_P95_UP_TO || 50);

const latency = new Trend('retrieve_latency', true);
const errors = new Rate('retrieve_errors');
const done = new Counter('retrieve_done');

const scen = levels(LEVELS, HOLD, '10s', (n) => `r${n}`, (n) => ({
  executor: 'constant-arrival-rate', rate: n, timeUnit: '1s', duration: HOLD,
  preAllocatedVUs: Math.max(10, n), maxVUs: Math.max(50, n * 4),
}));

export const options = {
  scenarios: scen,
  summaryTrendStats: trendStats,
  thresholds: thresholds(Object.keys(scen), { retrieve_latency: 'trend', retrieve_errors: 'rate', retrieve_done: 'counter' }, {
    retrieve_errors: () => ['rate<0.01'],
    retrieve_latency: (s) => (Number(s.slice(1)) <= P95_UP_TO ? [`p(95)<${P95_MS}`] : []),
  }),
};

const r = rng(Number(__ENV.SEED || 2) + __VU * 104729);

export default function () {
  const res = http.post(`${install.baseUrl}/v1/teams/${install.team}/kbs/${install.kbId}/retrieve`,
    JSON.stringify({ query: question(r), topK: 10 }), { headers: bearer(install.serviceKey), timeout: '60s', tags: { name: 'retrieve' } });
  const ok = check(res, {
    'retrieve 200': (x) => x.status === 200,
    'retrieve hits': (x) => x.status === 200 && (x.json('data.hits') || []).length > 0,
  });
  errors.add(!ok);
  if (!ok) {
    if (res.status !== 200) console.warn(`retrieve ${res.status}: ${String(res.body).slice(0, 200)}`);
    return;
  }
  latency.add(res.timings.duration);
  done.add(1);
}

export function handleSummary(data) {
  const rows = LEVELS.map((n) => ({ name: `r${n}`, label: `${n}/s offered`, seconds: seconds(HOLD) }));
  return output('retrieve', data, table(data, 'Retrieval (/retrieve, topK 10)', rows, [
    { title: 'requests', metric: 'retrieve_done', stat: 'count' },
    { title: 'achieved/s', metric: 'retrieve_done', stat: 'perSecond' },
    { title: 'p50', metric: 'retrieve_latency', stat: 'p(50)', unit: 'ms' },
    { title: 'p95', metric: 'retrieve_latency', stat: 'p(95)', unit: 'ms' },
    { title: 'p99', metric: 'retrieve_latency', stat: 'p(99)', unit: 'ms' },
    { title: 'errors', metric: 'retrieve_errors', stat: 'rate', unit: '%' },
  ]));
}
