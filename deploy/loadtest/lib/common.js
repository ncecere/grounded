// Shared helpers for the k6 scenarios (deploy/loadtest/README.md).
//
// Every scenario reads the install prepared by setup.js from
// $INSTALL (default /results/install.json): the base URL, the load team, its
// KB, sources, agent and API keys.
import http from 'k6/http';

export function loadInstall() {
  return JSON.parse(open(__ENV.INSTALL || '/results/install.json'));
}

export function bearer(key, extra) {
  return Object.assign({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, extra || {});
}

// A small deterministic PRNG (mulberry32), so every run uploads and asks the
// same things.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The synthetic corpus: TOPICS topics of made-up words, so the fake
// gateway's bag-of-words embeddings and Postgres full-text search both find
// the documents of a question's topic.
const SYLLABLES = ['ka', 'lo', 'mi', 'ra', 'ten', 'vor', 'sil', 'dun', 'pe', 'qua', 'bri', 'nox', 'tal', 'ume', 'zer', 'fin',
  'gal', 'hup', 'jas', 'kel', 'mor', 'nib', 'orp', 'ris', 'sto', 'tiv', 'ulm', 'vex', 'wyn', 'yor'];
export const TOPICS = 50;
const TOPIC_WORDS = 24;
const COMMON = ['the', 'process', 'request', 'policy', 'office', 'form', 'deadline', 'student', 'staff', 'account', 'system',
  'approval', 'record', 'service', 'support', 'guide', 'update', 'review', 'report', 'access', 'contact', 'online', 'team',
  'with', 'before', 'after', 'during', 'must', 'should', 'can', 'will', 'each', 'every', 'when', 'how', 'where'];

function makeWord(r) {
  let w = '';
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(r() * SYLLABLES.length)];
  return w;
}

const vocab = (() => {
  const r = rng(7);
  const topics = [];
  for (let t = 0; t < TOPICS; t++) {
    const words = [];
    while (words.length < TOPIC_WORDS) {
      const w = makeWord(r);
      if (!words.includes(w)) words.push(w);
    }
    topics.push(words);
  }
  return topics;
})();

function sentence(r, topic) {
  const n = 8 + Math.floor(r() * 12);
  const words = [];
  for (let i = 0; i < n; i++) {
    words.push(r() < 0.55 ? vocab[topic][Math.floor(r() * TOPIC_WORDS)] : COMMON[Math.floor(r() * COMMON.length)]);
  }
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// doc returns document i of a corpus: about 300-700 words in Markdown, a
// title and headings (1-3 chunks at the default chunk size).
export function doc(i, prefix) {
  const r = rng(1000 + i);
  const topic = i % TOPICS;
  const title = `${vocab[topic][0]} ${vocab[topic][1]} guide ${i}`;
  const parts = [`# ${title}`, ''];
  const sections = 2 + Math.floor(r() * 3);
  for (let s = 0; s < sections; s++) {
    parts.push(`## ${vocab[topic][2 + s]} ${vocab[topic][Math.floor(r() * TOPIC_WORDS)]}`, '');
    const paras = 1 + Math.floor(r() * 3);
    for (let p = 0; p < paras; p++) {
      const sentences = [];
      for (let k = 0; k < 4 + Math.floor(r() * 4); k++) sentences.push(sentence(r, topic));
      parts.push(sentences.join(' '), '');
    }
  }
  return { name: `${prefix || 'doc'}-${String(i).padStart(6, '0')}.md`, text: parts.join('\n') };
}

// question returns a question about a random topic.
export function question(r) {
  const topic = Math.floor(r() * TOPICS);
  const w = () => vocab[topic][Math.floor(r() * TOPIC_WORDS)];
  const forms = [
    () => `How does the ${w()} ${w()} process work?`,
    () => `What is the deadline for ${w()} and ${w()}?`,
    () => `Where do I request ${w()} ${w()} approval?`,
    () => `Can staff ${w()} the ${w()} record online?`,
  ];
  return forms[Math.floor(r() * forms.length)]();
}

export function followUp(r) {
  const topic = Math.floor(r() * TOPICS);
  return `And what about ${vocab[topic][Math.floor(r() * TOPIC_WORDS)]}?`;
}

// multipart builds a multipart/form-data body with one "files" part per
// document (k6's object form cannot repeat a field).
export function multipart(docs) {
  const boundary = `----grounded-load-${Math.floor(Math.random() * 1e12)}`;
  let body = '';
  for (const d of docs) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${d.name}"\r\n` +
      `Content-Type: text/markdown\r\n\r\n${d.text}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// sse splits a complete Server-Sent Events body into {event, data} records.
export function sse(body) {
  const out = [];
  for (const block of String(body || '').split('\n\n')) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length) out.push({ event, data: data.join('\n') });
  }
  return out;
}

// levels builds one k6 scenario per load level, run one after the other:
// name(level) -> the scenario name, make(level) -> its executor settings.
export function levels(list, hold, gap, name, make) {
  const scenarios = {};
  let start = 0;
  for (const level of list) {
    scenarios[name(level)] = Object.assign({ startTime: `${start}s`, gracefulStop: '30s' }, make(level));
    start += seconds(hold) + seconds(gap);
  }
  return scenarios;
}

export function seconds(d) {
  const m = String(d).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) throw new Error(`bad duration ${d}`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || 's'];
}

export function list(env, def) {
  return String(__ENV[env] || def).split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
}

// get polls a JSON endpoint and returns data, or null.
export function getJSON(url, headers) {
  const res = http.get(url, { headers, tags: { name: 'poll' } });
  if (res.status !== 200) return null;
  return res.json('data');
}
