// (a) Agent chat over SSE with the fake model, at increasing concurrency.
//
// Each level holds LEVELS[i] virtual users for HOLD, each asking questions
// back to back as one person (a personal API key: conversations are stored,
// as in the UI); FOLLOW_UP of the answers get a follow-up question in the
// same conversation (history and the query rewrite). The fake gateway's
// word delay (DEMO_FAKE_WORD_DELAY) sets how long an answer streams.
//
// chat_ttft is the time to the first byte of the stream. Grounded holds
// every event until the model starts answering (internal/agents
// streamer), so it is the time to the first token minus one word delay:
// auth, limits, conversation, retrieval, the prompt and the model's first
// byte. chat_total is the whole answer.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { bearer, followUp, levels, list, loadInstall, question, rng, seconds, sse } from './lib/common.js';
import { output, table, thresholds, trendStats } from './lib/summary.js';

const install = loadInstall();
const LEVELS = list('LEVELS', '25,50,100,200');
const HOLD = __ENV.HOLD || '60s';
const FOLLOW_UP = Number(__ENV.FOLLOW_UP || 0.3);
// DESIGN §1 sizing: 50 concurrent chats; the load target is twice that.
const TARGET = Number(__ENV.TARGET_CONCURRENCY || 100);
const TTFT_P95 = Number(__ENV.TTFT_P95_MS || 1500);

const ttft = new Trend('chat_ttft', true);
const total = new Trend('chat_total', true);
const errors = new Rate('chat_errors');
const answers = new Counter('chat_answers');

// Each level ramps up over RAMP (people do not all press Enter in the same
// second), then holds. RAMP=0s measures the burst instead.
const RAMP = __ENV.RAMP || '10s';
const scen = levels(LEVELS, `${seconds(RAMP) + seconds(HOLD)}s`, '15s', (n) => `c${n}`, (n) => ({
  executor: 'ramping-vus', startVUs: 0, stages: [{ duration: RAMP, target: n }, { duration: HOLD, target: n }],
}));

export const options = {
  scenarios: scen,
  summaryTrendStats: trendStats,
  thresholds: Object.assign(
    thresholds(Object.keys(scen), { chat_ttft: 'trend', chat_total: 'trend', chat_errors: 'rate', chat_answers: 'counter' }, {
      chat_errors: () => ['rate<0.01'],
      chat_ttft: (s) => (Number(s.slice(1)) <= TARGET ? [`p(95)<${TTFT_P95}`] : []),
    }),
  ),
};

const r = rng(Number(__ENV.SEED || 1) + __VU * 7919);

function ask(message, conversationId) {
  const body = { message, stream: true };
  if (conversationId) body.conversationId = conversationId;
  const res = http.post(`${install.baseUrl}/v1/agents/${install.team}/${install.agentSlug}/chat`, JSON.stringify(body),
    { headers: bearer(install.personalKey), timeout: '180s', tags: { name: 'chat' } });
  const events = res.status === 200 ? sse(res.body) : [];
  const names = events.map((e) => e.event);
  const ok = check(res, {
    'chat 200': (x) => x.status === 200,
    'chat done': () => names.includes('done') && !names.includes('error'),
    'chat answered': () => names.includes('message_end'),
  });
  errors.add(!ok);
  if (!ok) {
    if (res.status !== 200) console.warn(`chat ${res.status}: ${String(res.body).slice(0, 200)}`);
    return null;
  }
  ttft.add(res.timings.waiting);
  total.add(res.timings.duration);
  answers.add(1);
  const conv = events.find((e) => e.event === 'conversation');
  return conv ? JSON.parse(conv.data).conversationId : null;
}

export default function () {
  const conversationId = ask(question(r));
  if (conversationId && r() < FOLLOW_UP) ask(followUp(r), conversationId);
}

export function handleSummary(data) {
  const rows = LEVELS.map((n) => ({ name: `c${n}`, label: `${n} concurrent`, seconds: seconds(HOLD) + seconds(RAMP) / 2 }));
  return output('chat', data, table(data, `Chat over SSE (fake model, word delay ${__ENV.WORD_DELAY || 'see run'})`, rows, [
    { title: 'answers', metric: 'chat_answers', stat: 'count' },
    { title: 'answers/s', metric: 'chat_answers', stat: 'perSecond' },
    { title: 'TTFT p50', metric: 'chat_ttft', stat: 'p(50)', unit: 'ms' },
    { title: 'TTFT p95', metric: 'chat_ttft', stat: 'p(95)', unit: 'ms' },
    { title: 'TTFT p99', metric: 'chat_ttft', stat: 'p(99)', unit: 'ms' },
    { title: 'total p50', metric: 'chat_total', stat: 'p(50)', unit: 'ms' },
    { title: 'total p95', metric: 'chat_total', stat: 'p(95)', unit: 'ms' },
    { title: 'errors', metric: 'chat_errors', stat: 'rate', unit: '%' },
  ]));
}
