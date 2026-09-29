import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Page, test as base, expect } from "@playwright/test";
import { Api } from "./api";
import { type Persona, authFile } from "./env";

/** WCAG 2.1 A and AA (DESIGN §15). */
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** A page is its path plus its ?tab=, so every tab counts as a page. */
function pageKey(url: string): string | undefined {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  const tab = u.searchParams.get("tab");
  return u.origin + u.pathname + (tab ? `?tab=${tab}` : "");
}

/**
 * Accessibility for every page a spec visits. Each page opened through the
 * fixtures is tracked: every address it navigates to (including client-side
 * navigation) must be checked with `a11y(page)` once it has rendered, and the
 * final state of every page is checked when the test ends. A test fails on
 * any axe violation, when it visited a page it never checked, or when a page
 * threw an uncaught error. An address the app replaces before it renders (a
 * redirect from an old address, `history.replaceState`) doesn't need a check:
 * it was never shown.
 */
class A11y {
  private visited = new Map<Page, Set<string>>();
  private checked = new Set<string>();
  private errors: string[] = [];

  async track(page: Page) {
    const seen = new Set<string>();
    this.visited.set(page, seen);
    // Redirects replace the address before anything renders; forget the replaced one.
    await page.exposeFunction("__a11yReplaced", (from: string) => {
      const key = pageKey(from);
      if (key) seen.delete(key);
    });
    await page.addInitScript(() => {
      const replace = history.replaceState.bind(history);
      history.replaceState = (data, unused, url) => {
        const from = location.href;
        replace(data, unused, url);
        if (location.pathname !== new URL(from).pathname) void (window as unknown as { __a11yReplaced?: (u: string) => void }).__a11yReplaced?.(from);
      };
    });
    page.on("pageerror", (err) => this.errors.push(`${page.url()}: ${err.stack ?? err.message}`));
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const key = pageKey(frame.url());
      if (key) seen.add(key);
    });
  }

  async check(page: Page, what?: string) {
    // The app sets <title> and its landmarks once the page has rendered.
    await expect(page.locator("main").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    const key = pageKey(page.url());
    if (key) this.checked.add(key);
    const problems = results.violations.map(
      (v) => `  ${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n").join(" ")}`).join("\n")}`,
    );
    expect(problems, `axe violations on ${what ?? page.url()}:\n${problems.join("\n")}`).toEqual([]);
  }

  /** The end-of-test check of these pages (before their contexts close). */
  async finish(pages: Page[]) {
    for (const page of pages) {
      const seen = this.visited.get(page);
      if (!seen || page.isClosed()) continue;
      if (page.url() !== "about:blank") await this.check(page, `${page.url()} (end of test)`);
      const missed = [...seen].filter((k) => !this.checked.has(k));
      expect(missed, `pages visited without an accessibility check (call a11y(page) on them): ${missed.join(", ")}`).toEqual([]);
    }
    expect(this.errors, `uncaught errors in the page:\n${this.errors.join("\n")}`).toEqual([]);
  }
}

type Fixtures = {
  /** Checks the page with axe (WCAG 2.1 A/AA); see A11y. */
  a11y: (page: Page, what?: string) => Promise<void>;
  /** A new signed-in page for a persona, in its own browser context. */
  as: (persona: Persona) => Promise<Page>;
  /** The platform admin's API session, for arranging state. */
  admin: Api;
  a11yTracker: A11y;
};

async function openAs(browser: Browser, persona: Persona | undefined, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce", ...(persona ? { storageState: authFile(persona) } : {}) });
  return context.newPage();
}

export const test = base.extend<Fixtures>({
  a11yTracker: async ({}, use) => {
    await use(new A11y());
  },
  page: async ({ page, a11yTracker }, use, testInfo) => {
    await a11yTracker.track(page);
    await use(page);
    // Only a passing test's pages are checked at the end: a failure already says what went wrong.
    if (testInfo.status === testInfo.expectedStatus) await a11yTracker.finish([page]);
  },
  a11y: async ({ a11yTracker }, use) => {
    await use((page, what) => a11yTracker.check(page, what));
  },
  as: async ({ browser, a11yTracker, baseURL }, use, testInfo) => {
    const pages: Page[] = [];
    await use(async (persona) => {
      const page = await openAs(browser, persona, baseURL);
      await a11yTracker.track(page);
      pages.push(page);
      return page;
    });
    try {
      if (testInfo.status === testInfo.expectedStatus) await a11yTracker.finish(pages);
    } finally {
      await Promise.all(pages.map((p) => p.context().close()));
    }
  },
  admin: async ({}, use) => {
    const api = await Api.signIn("admin");
    await use(api);
    await api.dispose();
  },
});

export { expect };
