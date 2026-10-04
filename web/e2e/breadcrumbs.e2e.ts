import type { Page } from "@playwright/test";
import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Breadcrumbs (v0.4.2 re-test VI2-01, AD2-05, BU2-06, US2-05): every crumb shows in full while the trail fits the top
 * bar ("Admin" was cut to "…" with a thousand pixels free); a trail that doesn't fit stays on one line, cutting the
 * current page first, and never a crumb to a single letter.
 */
type Crumb = { text: string; shown: number; full: number };

/** Each crumb's visible and full text width, the trail's height and whether the page scrolls sideways. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]')!;
    const crumbs = Array.from(nav.querySelectorAll<HTMLElement>("li > a, li > [aria-current='page']")).map((el) => ({
      text: el.textContent ?? "",
      shown: el.clientWidth,
      full: el.scrollWidth,
    }));
    const line = parseFloat(getComputedStyle(nav).lineHeight) || 20;
    return { crumbs, oneLine: nav.getBoundingClientRect().height < line * 1.8, sideways: document.documentElement.scrollWidth > window.innerWidth };
  });
}

const cut = (c: Crumb) => c.full > c.shown + 1;

test("breadcrumbs show in full while they fit and stay on one line when they don't", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "crumbs" });
  const longName = "Undergraduate catalogue and academic regulations, 2026 to 2027 edition, with every appendix";
  const kb = await owner.post<{ id: string }>(`/v1/teams/${team}/kbs`, { name: longName });
  await owner.dispose();

  const page = await as("alex");
  const adminPage = await as("admin");
  const short: [Page, string][] = [
    [adminPage, "/admin/reranking"],
    [adminPage, "/admin/costs?tab=settings"],
    [page, `/teams/${team}/agents`],
  ];
  for (const [width, height] of [[1711, 1295], [1440, 900], [1024, 768]] as const) {
    for (const [p, path] of short) {
      await p.setViewportSize({ width, height });
      await p.goto(path);
      await expect(p.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem").first()).toBeVisible();
      await a11y(p, `${path} at ${width}`);
      const m = await measure(p);
      expect(m.crumbs.filter(cut), `${path} at ${width}: ${JSON.stringify(m.crumbs)}`).toEqual([]);
      expect(m.oneLine).toBe(true);
    }
  }

  // A long current page gives up room first: at desktop widths the crumbs before it stay whole.
  const kbPath = `/teams/${team}/kbs/${kb.id}`;
  for (const [width, height] of [[1711, 1295], [1440, 900], [1024, 768], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(kbPath);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByText(longName.slice(0, 20))).toBeVisible();
    await a11y(page, `long trail at ${width}`);
    const m = await measure(page);
    expect(m.oneLine, `${width}`).toBe(true);
    expect(m.sideways, `${width}`).toBe(false);
    const earlier = m.crumbs.slice(0, -1);
    if (width >= 1024) expect(earlier.filter(cut), `${width}: ${JSON.stringify(m.crumbs)}`).toEqual([]);
    // Never a single letter and an ellipsis: a cut crumb keeps at least its floor (or its whole text).
    for (const c of earlier) expect(c.shown, `${width}: ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(Math.min(c.full, 40));
  }

  // A phone keeps the short trails on one line too.
  for (const [p, path] of short) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(path);
    await expect(p.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem").first()).toBeVisible();
    await a11y(p, `${path} at 390`);
    const m = await measure(p);
    expect(m.oneLine, `${path} at 390`).toBe(true);
    expect(m.sideways, `${path} at 390`).toBe(false);
    for (const c of m.crumbs) expect(c.shown, `${path} at 390: ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(Math.min(c.full, 40));
  }
});
