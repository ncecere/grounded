// Prepares an install for the load tests through the API, as the
// development admin (DEV_AUTH; the fake models from `grounded demo
// --serve-fake-models` must exist): a team "load" with raised limits, an
// upload source with SEED_DOCS synthetic documents (embedded by the fake
// gateway), an empty second source for the ingest scenarios, a KB over both,
// a published agent, and two API keys (personal, for chat as a person; service,
// for retrieval and the OpenAI-compatible endpoint). Idempotent: existing
// objects are reused. Writes /results/install.json for the scenarios.
//
//   k6 run -e BASE_URL=http://host:30080 -e SEED_DOCS=1000 setup.js
import http from 'k6/http';
import { sleep } from 'k6';
import { doc, multipart } from './lib/common.js';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const TEAM = __ENV.TEAM || 'load';
const SEED_DOCS = Number(__ENV.SEED_DOCS || 1000);
const CLASSIFICATION = __ENV.CLASSIFICATION || 'open';
const HIGH = 1000000000;
// Development sign-in is refused unless the Host header is APP_URL's host.
const APP_HOST = __ENV.APP_HOST || 'localhost:8080';

export const options = {
  vus: 1,
  iterations: 1,
  setupTimeout: '40m',
  summaryTrendStats: ['avg', 'p(95)', 'max'],
};

let csrf = '';

function call(method, path, body, extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Host: APP_HOST }, (extra && extra.headers) || {});
  const res = http.request(method, BASE + path, body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    { headers, timeout: '120s', tags: { name: 'setup' }, responseCallback: http.expectedStatuses({ min: 200, max: 499 }) });
  const ok = (extra && extra.ok) || [200, 201, 204];
  if (!ok.includes(res.status)) {
    throw new Error(`${method} ${path}: ${res.status} ${String(res.body).slice(0, 500)}`);
  }
  return res;
}
const data = (res) => (res.body ? res.json('data') : null);

function signIn() {
  call('POST', '/auth/dev', { account: 'admin' });
  csrf = data(call('GET', '/v1/me')).csrfToken;
}

// waitFor retries fn (returning a value or null) every 2 s for up to secs.
function waitFor(what, secs, fn) {
  for (let i = 0; i < secs / 2; i++) {
    const v = fn();
    if (v) return v;
    sleep(2);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function ensureNamed(listPath, createPath, name, body) {
  const found = (data(call('GET', listPath)) || []).find((x) => x.name === name);
  if (found) return found;
  return data(call('POST', createPath, body));
}

function raiseLimits() {
  const res = call('GET', `/v1/admin/teams/${TEAM}/limits`);
  const want = {
    storage_bytes: 1024 * 1024 * 1024 * 1024, documents: 10000000, data_sources: 1000, knowledge_bases: 1000, agents: 1000,
    queries_per_minute: HIGH, queries_per_day: HIGH, api_key_queries_per_minute: HIGH, user_queries_per_minute: HIGH,
    chat_tokens_per_day: HIGH, concurrent_chats_per_user: 100000,
  };
  // The ingestion fairness cap stays at the platform default unless
  // INGEST_JOBS is given: it is one of the knobs the ingest runs measure.
  if (__ENV.INGEST_JOBS) want.concurrent_ingest_jobs = Number(__ENV.INGEST_JOBS);
  const items = Object.entries(want).map(([key, value]) => ({ key, value }));
  call('PUT', `/v1/admin/teams/${TEAM}/limits`, { items }, { headers: { 'If-Match': res.headers.Etag || res.headers.ETag } });
}

function uploadSeed(sourceId) {
  const have = data(call('GET', `/v1/teams/${TEAM}/sources/${sourceId}`)).documents.total;
  for (let i = have; i < SEED_DOCS; i += 100) {
    const docs = [];
    for (let j = i; j < Math.min(i + 100, SEED_DOCS); j++) docs.push(doc(j, 'seed'));
    const mp = multipart(docs);
    call('POST', `/v1/teams/${TEAM}/sources/${sourceId}/documents`, mp.body, { headers: { 'Content-Type': mp.contentType } });
  }
  const started = Date.now();
  const counts = waitFor('the seed documents', 1800, () => {
    const c = data(call('GET', `/v1/teams/${TEAM}/sources/${sourceId}`)).documents;
    return c.ready + c.failed + c.skipped >= SEED_DOCS ? c : null;
  });
  console.log(`seed: ${counts.ready} ready, ${counts.failed} failed, ${counts.chunks} chunks (${Math.round((Date.now() - started) / 1000)} s after the last upload)`);
  if (counts.failed > 0) throw new Error(`${counts.failed} seed documents failed`);
}

export function setup() {
  signIn();
  // The demo's fake models: grounded-fake-models seeds them at start.
  const models = waitFor('the demo fake models', 300, () => {
    const all = data(call('GET', '/v1/admin/models')) || [];
    const chat = all.find((m) => m.key === 'demo-fake-chat');
    const profile = (data(call('GET', '/v1/embedding-profiles')) || []).find((p) => p.key === 'demo-fake');
    return chat && profile ? { chat, profile } : null;
  });

  const teams = data(call('GET', `/v1/admin/teams?q=${TEAM}`));
  const items = (teams && (teams.items || teams)) || [];
  if (!items.find((t) => t.slug === TEAM)) {
    call('POST', '/v1/admin/teams', { slug: TEAM, name: 'Load test', maxClassification: CLASSIFICATION, ownerEmail: 'admin@localhost' },
      { ok: [200, 201, 409] });
  }
  raiseLimits();

  const sourceBody = (name) => ({ name, type: 'upload', classification: CLASSIFICATION, embeddingProfileId: models.profile.id });
  const seed = ensureNamed(`/v1/teams/${TEAM}/sources`, `/v1/teams/${TEAM}/sources`, 'Load seed', sourceBody('Load seed'));
  const ingest = ensureNamed(`/v1/teams/${TEAM}/sources`, `/v1/teams/${TEAM}/sources`, 'Load ingest', sourceBody('Load ingest'));
  const kb = ensureNamed(`/v1/teams/${TEAM}/kbs`, `/v1/teams/${TEAM}/kbs`, 'Load KB',
    { name: 'Load KB', embeddingProfileId: models.profile.id, topK: 10 });
  for (const s of [seed, ingest]) call('PUT', `/v1/teams/${TEAM}/kbs/${kb.id}/sources/${s.id}`, undefined, { ok: [200, 201, 204, 409] });

  uploadSeed(seed.id);

  let agent = (data(call('GET', `/v1/teams/${TEAM}/agents`)) || []).find((a) => a.slug === 'load');
  if (!agent) {
    agent = data(call('POST', `/v1/teams/${TEAM}/agents`, {
      name: 'Load agent', slug: 'load', description: 'Load-test agent',
      config: {
        instructions: 'Answer from the sources.', chatModelId: models.chat.id, kbs: [{ kbId: kb.id, topK: 6 }],
        audience: 'team',
      },
    }));
    call('POST', `/v1/teams/${TEAM}/agents/${agent.id}/publish`, { note: 'load test' });
  }

  // New keys each run: secrets are only shown once.
  const stamp = new Date().toISOString();
  const personal = data(call('POST', `/v1/teams/${TEAM}/api-keys`, { name: `load personal ${stamp}`, kind: 'personal', scopes: ['query', 'ingest'] }));
  const service = data(call('POST', `/v1/teams/${TEAM}/api-keys`, { name: `load service ${stamp}`, kind: 'service', scopes: ['query', 'ingest'] }));

  const seedCounts = data(call('GET', `/v1/teams/${TEAM}/sources/${seed.id}`)).documents;
  return {
    baseUrl: BASE, team: TEAM, kbId: kb.id, seedSourceId: seed.id, ingestSourceId: ingest.id,
    agentId: agent.id, agentSlug: 'load', openaiModel: `agent:${TEAM}/load`,
    personalKey: personal.secret, serviceKey: service.secret,
    seed: { documents: seedCounts.ready, chunks: seedCounts.chunks },
    preparedAt: stamp,
  };
}

export default function () {}

export function handleSummary(summary) {
  const install = summary.setup_data;
  if (!install) return { stdout: 'setup failed: no install data\n' };
  const safe = Object.assign({}, install, { personalKey: '<redacted>', serviceKey: '<redacted>' });
  return {
    stdout: `install ready: ${JSON.stringify(safe)}\n`,
    '/results/install.json': JSON.stringify(install, null, 2),
  };
}
