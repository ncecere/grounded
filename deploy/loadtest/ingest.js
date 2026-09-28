// (d) Uploads and ingest throughput: UPLOADERS virtual users upload DOCS
// synthetic Markdown documents in batches of BATCH (multipart, the ingest
// scope of a service key) to the "Load ingest" source, as fast as the API
// takes them; then the test waits until every document is ready (parsed,
// chunked, embedded by the fake gateway and indexed) and reports
// documents/min and chunks/s from the first upload to the last ready.
// run.sh also reads the same window from Postgres.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { bearer, doc, getJSON, loadInstall, multipart } from './lib/common.js';
import { output, trendStats } from './lib/summary.js';

const install = loadInstall();
const DOCS = Number(__ENV.DOCS || 5000);
const BATCH = Number(__ENV.BATCH || 50);
const UPLOADERS = Number(__ENV.UPLOADERS || 4);
const RUN = __ENV.RUN_ID || String(Date.now());
// DESIGN §1 sizing: a backfill at 10–40 chunks/s; the load target is twice
// the top of that.
const TARGET_CHUNKS_PER_S = Number(__ENV.TARGET_CHUNKS_PER_S || 80);

const upload = new Trend('ingest_upload_batch', true);
const errors = new Rate('ingest_upload_errors');
const uploaded = new Counter('ingest_docs_uploaded');
const readyAfter = new Trend('ingest_all_ready_after', true);

export const options = {
  scenarios: {
    upload: { executor: 'shared-iterations', vus: UPLOADERS, iterations: Math.ceil(DOCS / BATCH), maxDuration: '30m' },
  },
  teardownTimeout: '60m',
  summaryTrendStats: trendStats,
  thresholds: {
    ingest_upload_errors: ['rate<0.01'],
    ingest_upload_batch: ['p(95)<10000'],
  },
};

const sourceURL = () => `${install.baseUrl}/v1/teams/${install.team}/sources/${install.ingestSourceId}`;
const counts = () => {
  const s = getJSON(sourceURL(), bearer(install.serviceKey));
  return s ? s.documents : null;
};

export function setup() {
  const c = counts();
  if (!c) throw new Error('cannot read the ingest source');
  return { before: c, started: Date.now() };
}

export default function () {
  const b = exec.scenario.iterationInTest;
  const docs = [];
  for (let i = b * BATCH; i < Math.min((b + 1) * BATCH, DOCS); i++) docs.push(doc(i, `ingest-${RUN}`));
  const mp = multipart(docs);
  const res = http.post(`${sourceURL()}/documents`, mp.body, {
    headers: bearer(install.serviceKey, { 'Content-Type': mp.contentType }), timeout: '120s', tags: { name: 'upload' },
  });
  const ok = check(res, { 'upload 200': (x) => x.status === 200 });
  errors.add(!ok);
  if (!ok) {
    console.warn(`upload ${res.status}: ${String(res.body).slice(0, 200)}`);
    return;
  }
  upload.add(res.timings.duration);
  uploaded.add(docs.length);
}

export function teardown(data) {
  const want = data.before.total + DOCS;
  let c = counts();
  while (!c || c.ready + c.failed + c.skipped < want) {
    sleep(2);
    c = counts() || c;
  }
  const secs = (Date.now() - data.started) / 1000;
  readyAfter.add(secs * 1000);
  const docs = c.ready - data.before.ready;
  const chunks = c.chunks - data.before.chunks;
  console.log(JSON.stringify({ ingest: { docs, chunks, failed: c.failed - data.before.failed, seconds: secs,
    docsPerMin: (docs / secs) * 60, chunksPerSec: chunks / secs } }));
}

export function handleSummary(data) {
  const m = (k, s) => (data.metrics[k] ? data.metrics[k].values[s] : undefined);
  const secs = m('ingest_all_ready_after', 'max') / 1000;
  const docs = m('ingest_docs_uploaded', 'count');
  const up = m('ingest_upload_batch', 'count');
  const lines = [
    `### Uploads and ingest (${DOCS} documents, batches of ${BATCH}, ${UPLOADERS} uploaders)`, '',
    '| measure | value |', '|---|---:|',
    `| documents uploaded | ${docs} |`,
    `| upload batch p50 / p95 | ${Math.round(m('ingest_upload_batch', 'med'))} ms / ${Math.round(m('ingest_upload_batch', 'p(95)'))} ms |`,
    `| upload errors | ${((m('ingest_upload_errors', 'rate') || 0) * 100).toFixed(2)} % (${up} batches) |`,
    `| first upload to last ready | ${secs.toFixed(0)} s |`,
    `| documents/min to ready | ${((docs / secs) * 60).toFixed(0)} |`,
    `| target (2× sizing) | ${TARGET_CHUNKS_PER_S} chunks/s; see run.sh's Postgres figures for chunks/s |`, '',
  ];
  return output('ingest', data, lines.join('\n'));
}
