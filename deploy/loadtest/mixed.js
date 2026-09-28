// (e) A day in the life at twice the DESIGN §1 sizing, all at once for
// DURATION. The sizing example: 5,000 daily active users, 50 concurrent
// chats, 20,000 queries a day, a backfill of about 1M documents in two weeks.
// Doubled, and taken at the busy hour:
//   chat      CHAT_VUS (100) answers streaming at all times (after a RAMP
//             of 30 s), as people (a
//             personal key; stored conversations, 30% follow-ups). Run it
//             with a word delay that makes an answer take as long as a real
//             model's (run.sh: 80 ms, about 14 s like the one-GPU Spark).
//   retrieve  RETRIEVE_RATE (3/s) API retrievals (service key).
//   openai    OPENAI_RATE (1/s) OpenAI-compatible completions.
//   upload    UPLOAD_EVERY (6 s) a batch of 10 documents: 100 documents/min,
//             twice the backfill rate.
//   browse    BROWSE_RATE (10/s) reads a signed-in user's pages make:
//             agents, conversations, KBs, a source (10,000 users × about 30
//             requests over an 8-hour day).
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { bearer, doc, followUp, loadInstall, multipart, question, rng, sse } from './lib/common.js';
import { output, trendStats } from './lib/summary.js';

const install = loadInstall();
const DURATION = __ENV.DURATION || '10m';
const CHAT_VUS = Number(__ENV.CHAT_VUS || 100);
const RUN = __ENV.RUN_ID || String(Date.now());

const m = {
  chatTTFT: new Trend('mixed_chat_ttft', true), chatTotal: new Trend('mixed_chat_total', true),
  retrieve: new Trend('mixed_retrieve', true), openai: new Trend('mixed_openai', true),
  upload: new Trend('mixed_upload', true), browse: new Trend('mixed_browse', true),
  errors: new Rate('mixed_errors'), answers: new Counter('mixed_chat_answers'), docs: new Counter('mixed_docs_uploaded'),
};

const arrival = (rate, timeUnit, exec) => ({
  executor: 'constant-arrival-rate', rate, timeUnit, duration: DURATION, preAllocatedVUs: 20, maxVUs: 200, exec,
});

export const options = {
  scenarios: {
    chat: {
      executor: 'ramping-vus', startVUs: 0, exec: 'chat', gracefulStop: '60s',
      stages: [{ duration: __ENV.RAMP || '30s', target: CHAT_VUS }, { duration: DURATION, target: CHAT_VUS }],
    },
    retrieve: arrival(Number(__ENV.RETRIEVE_RATE || 3), '1s', 'retrieve'),
    openai: arrival(Number(__ENV.OPENAI_RATE || 1), '1s', 'openai'),
    upload: arrival(1, __ENV.UPLOAD_EVERY || '6s', 'upload'),
    browse: arrival(Number(__ENV.BROWSE_RATE || 10), '1s', 'browse'),
  },
  summaryTrendStats: trendStats,
  thresholds: {
    'mixed_errors{scenario:chat}': ['rate<0.01'],
    'mixed_errors{scenario:retrieve}': ['rate<0.01'],
    'mixed_errors{scenario:openai}': ['rate<0.01'],
    'mixed_errors{scenario:upload}': ['rate<0.01'],
    'mixed_errors{scenario:browse}': ['rate<0.01'],
    mixed_chat_ttft: [`p(95)<${Number(__ENV.TTFT_P95_MS || 2000)}`],
    mixed_retrieve: [`p(95)<${Number(__ENV.RETRIEVE_P95_MS || 500)}`],
    mixed_browse: [`p(95)<${Number(__ENV.BROWSE_P95_MS || 300)}`],
    mixed_upload: ['p(95)<5000'],
    mixed_openai: ['max>=0'],
    mixed_chat_total: ['max>=0'],
  },
};

const r = rng(Number(__ENV.SEED || 5) + __VU * 32452843);
const personal = () => bearer(install.personalKey);
const service = (extra) => bearer(install.serviceKey, extra);

function record(res, ok, trend, name) {
  m.errors.add(!ok);
  if (!ok) {
    console.warn(`${name} ${res.status}: ${String(res.body).slice(0, 200)}`);
    return false;
  }
  trend.add(res.timings.duration);
  return true;
}

function ask(message, conversationId) {
  const body = { message, stream: true };
  if (conversationId) body.conversationId = conversationId;
  const res = http.post(`${install.baseUrl}/v1/agents/${install.team}/${install.agentSlug}/chat`, JSON.stringify(body),
    { headers: personal(), timeout: '180s', tags: { name: 'chat' } });
  const events = res.status === 200 ? sse(res.body) : [];
  const names = events.map((e) => e.event);
  const ok = check(res, { 'chat ok': (x) => x.status === 200 && names.includes('done') && !names.includes('error') });
  m.errors.add(!ok);
  if (!ok) {
    console.warn(`chat ${res.status}: ${String(res.body).slice(0, 200)}`);
    return null;
  }
  m.chatTTFT.add(res.timings.waiting);
  m.chatTotal.add(res.timings.duration);
  m.answers.add(1);
  const conv = events.find((e) => e.event === 'conversation');
  return conv ? JSON.parse(conv.data).conversationId : null;
}

export function chat() {
  const id = ask(question(r));
  if (id && r() < 0.3) ask(followUp(r), id);
}

export function retrieve() {
  const res = http.post(`${install.baseUrl}/v1/teams/${install.team}/kbs/${install.kbId}/retrieve`,
    JSON.stringify({ query: question(r), topK: 10 }), { headers: service(), timeout: '60s', tags: { name: 'retrieve' } });
  record(res, check(res, { 'retrieve ok': (x) => x.status === 200 }), m.retrieve, 'retrieve');
}

export function openai() {
  const res = http.post(`${install.baseUrl}/v1/chat/completions`, JSON.stringify({
    model: install.openaiModel, stream: false, messages: [{ role: 'user', content: question(r) }],
  }), { headers: service(), timeout: '180s', tags: { name: 'openai' } });
  record(res, check(res, { 'openai ok': (x) => x.status === 200 }), m.openai, 'openai');
}

export function upload() {
  const b = exec.scenario.iterationInTest;
  const docs = [];
  for (let i = b * 10; i < (b + 1) * 10; i++) docs.push(doc(i, `mixed-${RUN}`));
  const mp = multipart(docs);
  const res = http.post(`${install.baseUrl}/v1/teams/${install.team}/sources/${install.ingestSourceId}/documents`, mp.body,
    { headers: service({ 'Content-Type': mp.contentType }), timeout: '120s', tags: { name: 'upload' } });
  if (record(res, check(res, { 'upload ok': (x) => x.status === 200 }), m.upload, 'upload')) m.docs.add(docs.length);
}

const pages = [
  () => '/v1/agents',
  () => '/v1/conversations',
  () => `/v1/teams/${install.team}/kbs`,
  () => `/v1/teams/${install.team}/sources/${install.seedSourceId}`,
  () => `/v1/teams/${install.team}/sources/${install.seedSourceId}/documents?limit=25`,
];

export function browse() {
  const path = pages[Math.floor(r() * pages.length)]();
  const res = http.get(install.baseUrl + path, { headers: personal(), timeout: '60s', tags: { name: 'browse' } });
  record(res, check(res, { 'browse ok': (x) => x.status === 200 }), m.browse, 'browse');
}

export function handleSummary(data) {
  const v = (k) => (data.metrics[k] ? data.metrics[k].values : {});
  const ms = (x) => (x === undefined ? '–' : x >= 10000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
  const err = (s) => {
    const e = v(`mixed_errors{scenario:${s}}`).rate;
    return e === undefined ? '–' : `${(e * 100).toFixed(2)} %`;
  };
  const row = (label, s, trend, extra) => {
    const t = v(trend);
    return `| ${label} | ${t.count || 0} | ${ms(t.med)} | ${ms(t['p(95)'])} | ${ms(t['p(99)'])} | ${err(s)} | ${extra || ''} |`;
  };
  const failed = Object.entries(data.metrics).filter(([, x]) => x.thresholds && Object.values(x.thresholds).some((t) => !t.ok)).map(([k]) => k);
  const lines = [
    `### Mixed day in the life (${DURATION}, ${CHAT_VUS} concurrent chats)`, '',
    '| traffic | requests | p50 | p95 | p99 | errors | notes |', '|---|---:|---:|---:|---:|---:|---|',
    row('chat, time to first token', 'chat', 'mixed_chat_ttft', `${v('mixed_chat_answers').count || 0} answers`),
    row('chat, whole answer', 'chat', 'mixed_chat_total'),
    row('retrieve', 'retrieve', 'mixed_retrieve'),
    row('OpenAI-compatible', 'openai', 'mixed_openai'),
    row('upload (10 documents)', 'upload', 'mixed_upload', `${v('mixed_docs_uploaded').count || 0} documents`),
    row('browse (reads)', 'browse', 'mixed_browse'),
    '', failed.length ? `Thresholds failed: ${failed.join(', ')}` : 'All thresholds passed.', '',
  ];
  return output('mixed', data, lines.join('\n'));
}
