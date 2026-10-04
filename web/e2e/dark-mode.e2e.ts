/*
 * Dark mode (VI-38): the app follows the system's light or dark setting, with System / Light / Dark in the account
 * menu (kept in this browser). public/color-mode.js sets <html data-theme> before the body is parsed, so there's no
 * flash of the wrong theme. Pages in dark pass axe (WCAG 2.1 AA, colour contrast included).
 */
import { type Page } from "@playwright/test";
import { Api } from "./support/api";
import { createTeam, handbook, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

const theme = (page: Page) => page.locator("html");

/** Records the first data-theme <html> gets, and whether <body> existed yet (it mustn't: no paint before it). */
async function watchFirstTheme(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __firstTheme?: { theme?: string; body: boolean } };
    // <html> may not exist yet when this runs: watch the document.
    const obs = new MutationObserver((records) => {
      if (w.__firstTheme || !records.some((r) => r.target === document.documentElement)) return;
      w.__firstTheme = { theme: document.documentElement.dataset.theme, body: Boolean(document.body) };
      obs.disconnect();
    });
    obs.observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });
  });
}
const firstTheme = (page: Page) => page.evaluate(() => (window as unknown as { __firstTheme?: { theme?: string; body: boolean } }).__firstTheme);

async function chooseTheme(page: Page, name: "System" | "Light" | "Dark") {
  await page.getByRole("button", { name: /^Account: / }).click();
  const item = page.getByRole("group", { name: "Theme" }).getByRole("menuitemradio", { name });
  await item.click();
  await expect(item).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
}

test("follows the system's dark setting, keeps a Light or Dark choice, and pages in dark pass axe", async ({ as, admin, a11y }) => {
  const alex = await Api.signIn("alex");
  const team = await createTeam(admin, alex, { prefix: "dark" });
  const { agent } = await publishedAgent(alex, team, { name: "Dark parking" });
  await alex.dispose();

  const page = await as("alex");
  const csp: string[] = [];
  page.on("console", (m) => m.text().includes("Content Security Policy") && csp.push(m.text()));
  await watchFirstTheme(page);
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto(`/teams/${team}`);
  await expect(page.getByRole("heading", { level: 1, name: `E2E ${team}` })).toBeVisible();
  await expect(theme(page)).toHaveAttribute("data-theme", "dark");
  expect(await firstTheme(page)).toEqual({ theme: "dark", body: false });
  await a11y(page, "team overview in dark");

  // A chat with an answer, its citation and the source viewer.
  await page.goto(`/a/${team}/${agent.slug}`);
  const composer = page.getByRole("textbox", { name: "Message Dark parking" });
  await composer.fill("How much is a student parking permit?");
  await composer.press("Enter");
  const answer = page.getByRole("article", { name: "Dark parking said" });
  await expect(answer).toContainText(handbook.answer);
  await a11y(page, "chat answer in dark");
  await answer.getByRole("button", { name: "Used 1 source" }).click();
  await answer.getByRole("button", { name: /^Show source 1: / }).click();
  await expect(page.getByTestId("source-viewer").getByTestId("cited-passage")).toContainText(handbook.answer);
  await a11y(page, "source viewer in dark");

  await page.goto(`/teams/${team}/sources`);
  await expect(page.getByRole("heading", { level: 1, name: "Data sources" })).toBeVisible();
  await a11y(page, "data sources in dark");

  // Light while the system is dark, after a reload too.
  await chooseTheme(page, "Light");
  await expect(theme(page)).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Data sources" })).toBeVisible();
  await expect(theme(page)).toHaveAttribute("data-theme", "light");
  expect(await firstTheme(page)).toEqual({ theme: "light", body: false });

  // Dark while the system is light; System follows the system again.
  await page.emulateMedia({ colorScheme: "light" });
  await chooseTheme(page, "Dark");
  await expect(theme(page)).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(theme(page)).toHaveAttribute("data-theme", "dark");
  await a11y(page, "data sources, Dark chosen");
  await chooseTheme(page, "System");
  await expect(theme(page)).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(theme(page)).toHaveAttribute("data-theme", "dark");
  expect(csp).toEqual([]);
});

test("admin pages in dark pass axe", async ({ as, a11y }) => {
  const page = await as("admin");
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [path, heading] of [
    ["/admin", "Overview"],
    ["/admin/costs", "Costs"],
    ["/admin/analytics", "Analytics"],
    ["/admin/models", "Models"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(theme(page)).toHaveAttribute("data-theme", "dark");
    await a11y(page, `${path} in dark`);
  }
});

test("the public page follows a visitor's dark setting", async ({ page, admin, a11y }) => {
  const alex = await Api.signIn("alex");
  const team = await createTeam(admin, alex, { prefix: "dark-public" });
  const { agent } = await publishedAgent(alex, team, { name: "Dark public", audience: "public" });
  await alex.dispose();

  await watchFirstTheme(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/a/${team}/${agent.slug}`);
  await expect(page.getByRole("textbox", { name: "Message Dark public" })).toBeEnabled();
  await expect(theme(page)).toHaveAttribute("data-theme", "dark");
  expect(await firstTheme(page)).toEqual({ theme: "dark", body: false });
  await a11y(page, "public page in dark");
});
