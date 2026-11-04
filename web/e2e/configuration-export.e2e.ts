import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

test("team settings exports checked YAML by keyboard at 390px", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "configuration" });
  await owner.dispose();
  const page = await as("alex");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/teams/${team}/settings?tab=general`);
  const button = page.getByRole("button", { name: "Export configuration" });
  await expect(button).toBeVisible();
  await a11y(page, "configuration export at 390px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await button.focus();
  const downloadEvent = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("team-configuration.yaml");
  await expect(page.getByRole("status").filter({ hasText: "Configuration checked" })).toBeVisible();
  await page.screenshot({ path: "e2e-output/configuration-export-390.png", fullPage: true });
});
