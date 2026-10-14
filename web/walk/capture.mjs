#!/usr/bin/env node
// A QA walk (docs/specs/cluster-testing/SPEC-cluster-walks.md): signs in as each development persona through the development
// sign-in, opens each page of the manifest at each width, takes a screenshot, and checks the page for accessibility violations
// (the e2e suite's WCAG tags), console and uncaught page errors, sideways overflow and a "Page not found" page.
//
//   WALK_BASE_URL   the application's address, as APP_URL has it (default http://localhost:18480); the development sign-in needs it
//   WALK_TARGET     host:port to forward that address to (in a cluster Job: the environment's Service); without it, BASE_URL is used as is
//   WALK_OUT        the output directory (default walk-output): <persona>/<page>-<width>.png, report.json, summary.txt
//   WALK_MANIFEST   the manifest (default walks.json beside this file)
//   WALK_PERSONAS, WALK_WIDTHS   comma-separated, to narrow the walk
//
// Exits 0 only if every capture is ok (manifest.mjs says what ok is). report.json lists the captures in manifest order with the
// same keys every time, so two walks of two refs can be compared.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { startForwarder } from "./forward.mjs";
import { expand, isAllowed, summarize } from "./manifest.mjs";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]; // as e2e/support/fixtures.ts
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

const base = new URL(process.env.WALK_BASE_URL ?? "http://localhost:18480");
const out = path.resolve(process.env.WALK_OUT ?? "walk-output");
const manifestFile = process.env.WALK_MANIFEST ?? new URL("./walks.json", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const captures = expand(manifest, { personas: list(process.env.WALK_PERSONAS), widths: list(process.env.WALK_WIDTHS)?.map(Number) });
if (captures.length === 0) {
  console.error("nothing to walk: the persona and width filters leave no page");
  process.exit(2);
}

let forwarder;
if (process.env.WALK_TARGET) {
  const [host, port] = process.env.WALK_TARGET.split(":");
  forwarder = await startForwarder(Number(base.port || 80), host, Number(port));
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [];

try {
  for (const persona of [...new Set(captures.map((c) => c.persona))]) {
    const context = await browser.newContext({ baseURL: base.origin, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" });
    const signIn = await context.request.post("/auth/dev", { data: { account: persona }, headers: { Origin: base.origin } });
    if (!signIn.ok()) {
      // the persona cannot sign in: every one of its captures fails with that, instead of the walk stopping
      for (const c of captures.filter((x) => x.persona === persona)) results.push(blank(c, `sign-in as ${persona} answered ${signIn.status()}`));
      await context.close();
      continue;
    }
    for (const c of captures.filter((x) => x.persona === persona)) results.push(await capture(context, c));
    await context.close();
  }
} finally {
  await browser.close();
  forwarder?.close();
}

/** @param {import("./manifest.mjs").Capture} c @param {string} [error] */
function blank(c, error) {
  return { persona: c.persona, path: c.path, width: c.width, file: c.file, axe: [], console: [], allowed: 0, overflow: false, notFound: false, ...(error ? { error } : {}) };
}

async function capture(context, c) {
  const result = blank(c);
  const page = await context.newPage();
  const errors = [];
  // The browser's own line for a failed request ("Failed to load resource: ... 404") names no address, so the request is recorded
  // instead, with its status and path; the application's own console errors are kept as they are.
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text().slice(0, 300)));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
  page.on("pageerror", (e) => errors.push(`uncaught: ${String(e.message ?? e).slice(0, 300)}`));
  try {
    await page.setViewportSize({ width: c.width, height: c.width < 600 ? 844 : 900 });
    await page.goto(c.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(c.wait ?? "main, #main").first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(600); // let what the page loads on arrival settle; polling pages never go quiet
    result.notFound = await page.getByText("Page not found", { exact: false }).first().isVisible().catch(() => false);
    result.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    result.axe = axe.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length })).sort((a, b) => a.id.localeCompare(b.id));
    fs.mkdirSync(path.dirname(path.join(out, c.file)), { recursive: true });
    await page.screenshot({ path: path.join(out, c.file), fullPage: c.width >= 1440 });
  } catch (e) {
    result.error = String(e.message ?? e).split("\n")[0].slice(0, 300);
  } finally {
    result.console = errors.filter((e) => !isAllowed(manifest, e));
    result.allowed = errors.length - result.console.length; // expected messages (the manifest says why), counted so none is hidden
    await page.close();
  }
  return result;
}

const summary = summarize(results);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ base: base.origin, pages: summary.pages, failed: summary.failed, captures: results }, null, 2) + "\n");
const text = [`${summary.pages} captures, ${summary.failed} not ok`, ...summary.lines].join("\n");
fs.writeFileSync(path.join(out, "summary.txt"), text + "\n");
console.log(text);
process.exit(summary.ok ? 0 : 1);
