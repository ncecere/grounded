import { Api } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * ⌘K and the navigation chrome (docs/v0.2.0.md §7): quick open → type →
 * Escape cycles while slow searches are on their way leave the page
 * responsive and every search cancelled (M5); team words (spend, members)
 * find Team settings' tabs; on a 390px phone the sidebar is a drawer and a
 * page header keeps only its primary action.
 */

test("⌘K stays responsive through quick open, type and close cycles with slow searches", async ({ as, admin, a11y }) => {
  const alex = await Api.signIn("alex");
  const team = await createTeam(admin, alex, { prefix: "palette" });
  await alex.dispose();
  const page = await as("alex");
  let searches = 0;
  let cancelled = 0;
  page.on("requestfailed", (r) => {
    if (r.url().includes("/v1/search")) cancelled++;
  });
  await page.route("**/v1/search?**", async (route) => {
    searches++;
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  await page.goto(`/teams/${team}`);
  await expect(page.getByRole("heading", { level: 1, name: `E2E ${team}` })).toBeVisible();
  await a11y(page);

  const palette = page.getByRole("dialog", { name: "Command palette" });
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.type(["transcript", "members", "audit log"][i % 3]!);
    // Every fifth cycle waits past the debounce, so a search is on its way when Escape comes.
    if (i % 5 === 4) await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
  }
  await expect(palette).toBeHidden();
  // Only the cycles that waited searched, and closing cancelled them.
  expect(searches).toBeLessThanOrEqual(3);
  await expect.poll(() => cancelled).toBe(searches);
  const started = Date.now();
  await page.evaluate(() => document.title);
  expect(Date.now() - started).toBeLessThan(1000);

  // Team words find Team settings' tabs.
  await page.unroute("**/v1/search?**");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("spend");
  await palette.getByRole("option", { name: /^Usage & limits/ }).click();
  await expect(page).toHaveURL(`/teams/${team}/settings?tab=usage`);
  await expect(page.getByRole("heading", { level: 1, name: "Team settings" })).toBeVisible();
  await a11y(page);
});

test("on a 390px phone the sidebar is a drawer and a page header keeps only its primary action", async ({ admin, a11y, as }) => {
  test.setTimeout(90_000);
  const alex = await Api.signIn("alex");
  const team = await createTeam(admin, alex, { prefix: "phone" });
  const { agent } = await publishedAgent(alex, team, { name: "Phone helper" });
  await alex.dispose();
  const page = await as("alex");
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`/teams/${team}/agents/${agent.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Phone helper" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace sidebar" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat" })).toBeHidden();
  await a11y(page);
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Try it" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Chat" })).toBeVisible();
  await a11y(page, "header actions menu on a phone");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await a11y(page, "navigation drawer");
  await drawer.getByRole("link", { name: "Knowledge bases" }).click();
  await expect(page).toHaveURL(`/teams/${team}/kbs`);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge bases" })).toBeVisible();
  // Focus goes to the new page's content, not back to "Open navigation".
  await expect(page.getByRole("main")).toBeFocused();
  await a11y(page);
});
