// The walk manifest (docs/specs/cluster-testing/SPEC-cluster-walks.md): which pages each development persona is walked through,
// at which widths. Plain functions, no browser: capture.mjs does the browsing, manifest.test.mjs covers this.

/** The development personas (internal/auth/dev.go; e2e/support/env.ts). Only admin is in the Demo team. */
export const PERSONAS = ["admin", "auditor", "user", "alex", "blair", "casey"];

/** A phone, a laptop and a large desktop: the widths the earlier UI reviews used. */
export const DEFAULT_WIDTHS = [1440, 1280, 390];

/**
 * @typedef {{ persona: string, path: string, wait?: string }} Page
 * @typedef {{ match: string, reason: string }} Allow
 * @typedef {{ widths?: number[], pages: Page[], allow?: Allow[] }} Manifest
 * @typedef {{ persona: string, path: string, width: number, file: string, wait?: string }} Capture
 */

/** What is wrong with a manifest, one sentence per problem (empty when it is fine). @param {unknown} m */
export function validate(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["the manifest must be an object with pages"];
  const problems = [];
  const { widths, pages, allow } = /** @type {Record<string, unknown>} */ (m);
  if (allow !== undefined) {
    if (!Array.isArray(allow)) problems.push("allow must be a list");
    else allow.forEach((a, i) => {
      let valid = typeof a?.match === "string";
      if (valid) try { new RegExp(a.match); } catch { valid = false; }
      if (!valid) problems.push(`allow[${i}]: match ${JSON.stringify(a?.match)} is not a valid pattern`);
      if (typeof a?.reason !== "string" || !a.reason.trim()) problems.push(`allow[${i}]: a reason is required (why this message is expected)`);
    });
  }
  if (widths !== undefined) {
    if (!Array.isArray(widths) || widths.length === 0) problems.push("widths must be a non-empty list of widths");
    else for (const w of widths) if (!Number.isInteger(w) || w < 200 || w > 4000) problems.push(`width ${JSON.stringify(w)} is not a whole number from 200 to 4000`);
  }
  if (!Array.isArray(pages)) return [...problems, "pages must be a list"];
  if (pages.length === 0) problems.push("the manifest needs at least one page");
  const seen = new Set();
  pages.forEach((p, i) => {
    if (p && typeof p === "object" && typeof p.path === "string") {
      const key = `${p.persona} ${p.path}`;
      if (seen.has(key)) problems.push(`pages[${i}]: ${p.persona} ${p.path} is listed twice`);
      seen.add(key);
    }
    const at = `pages[${i}]`;
    if (!p || typeof p !== "object") return problems.push(`${at} must be an object`);
    if (!PERSONAS.includes(p.persona)) problems.push(`${at}: persona ${JSON.stringify(p.persona)} is not one of ${PERSONAS.join(", ")}`);
    // a path stays on the environment: one slash, never an absolute URL or a protocol-relative one
    if (typeof p.path !== "string" || !p.path.startsWith("/") || p.path.startsWith("//")) problems.push(`${at}: path ${JSON.stringify(p.path)} must start with a single /`);
    if (p.wait !== undefined && typeof p.wait !== "string") problems.push(`${at}: wait must be a selector`);
  });
  return problems;
}

/**
 * True when a console message is one the manifest says to expect: a pattern that matches the whole message, with a reason on record.
 * @param {{ allow?: Allow[] }} m @param {string} message
 */
export function isAllowed(m, message) {
  return (m.allow ?? []).some((a) => new RegExp(`^(?:${a.match})$`).test(message));
}

/**
 * The captures of a manifest, in its order: each page at each width. `only` narrows to some personas or widths.
 * @param {Manifest} m @param {{ personas?: string[], widths?: number[] }} [only] @returns {Capture[]}
 */
export function expand(m, only = {}) {
  const problems = validate(m);
  if (problems.length) throw new Error(`invalid walk manifest: ${problems.join("; ")}`);
  const widths = only.widths?.length ? only.widths : (m.widths ?? DEFAULT_WIDTHS);
  const stems = new Map(); // persona + slug -> the paths that use it, so "/a/b" and "/a-b" never share a file
  const stemOf = (persona, path) => {
    const key = `${persona}/${slug(path)}`;
    const paths = stems.get(key) ?? [];
    if (!paths.includes(path)) paths.push(path);
    stems.set(key, paths);
    const n = paths.indexOf(path);
    return n === 0 ? slug(path) : `${slug(path)}-${n + 1}`;
  };
  const out = [];
  for (const p of m.pages) {
    if (only.personas?.length && !only.personas.includes(p.persona)) continue;
    const stem = stemOf(p.persona, p.path);
    for (const width of widths) out.push({ persona: p.persona, path: p.path, width, file: `${p.persona}/${stem}-${width}.png`, ...(p.wait ? { wait: p.wait } : {}) });
  }
  return out;
}

/** A file-name part from a path: "/admin/models" is "admin-models", "/" is "home". @param {string} path */
export function slug(path) {
  const s = path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return s || "home";
}


/** @typedef {{ id: string, impact: string | null, nodes: number }} AxeFinding */
/** @typedef {Capture & { axe: AxeFinding[], console: string[], overflow: boolean, notFound: boolean, error?: string }} Result */

/** True when nothing is wrong with the page: no accessibility violation, console error, sideways overflow, not-found page or failure. @param {Result} r */
export function pageOk(r) {
  return !r.error && !r.notFound && !r.overflow && r.axe.length === 0 && r.console.length === 0;
}

/** Why a page is not ok, in a few words. @param {Result} r */
function why(r) {
  const out = [];
  if (r.error) out.push(`failed: ${r.error}`);
  if (r.notFound) out.push("shows 'Page not found'");
  if (r.overflow) out.push("overflow sideways");
  if (r.axe.length) out.push(`axe ${r.axe.map((a) => a.id).join(", ")}`);
  if (r.console.length) out.push(`${r.console.length} console error(s)`);
  return out.join("; ");
}

/** The verdict of a walk: how many pages, which failed and why, and whether it is ok (a walk that captured nothing is not). @param {Result[]} results */
export function summarize(results) {
  const bad = results.filter((r) => !pageOk(r));
  return {
    pages: results.length,
    failed: bad.length,
    ok: results.length > 0 && bad.length === 0,
    lines: bad.map((r) => `${r.persona} ${r.path} ${r.width}: ${why(r)}`),
  };
}
