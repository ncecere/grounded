import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

// Team settings → Import configuration (docs/specs/config-as-code-import): a real check against the server, by keyboard,
// at a phone's width. An empty file changes nothing and is never applied.
test("checks a configuration file by keyboard at 390px", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "cfgimport" });
  await owner.dispose();
  const page = await as("alex");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/teams/${team}/settings?tab=general`);
  await page.getByRole("link", { name: "Import configuration…" }).click();
  await expect(page.getByRole("heading", { name: "Import configuration" })).toBeVisible();
  const box = page.getByRole("textbox", { name: "Configuration (YAML)" });
  await box.fill("apiVersion: grounded.team/v1\nsources: []\nknowledgeBases: []\nagents: []\nevaluationSets: []\nwebhooks: []\n");
  await page.getByRole("button", { name: "Check changes" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("The team already matches this file: there is nothing to apply.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await a11y(page, "configuration import at 390px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "e2e-output/configuration-import-390.png", fullPage: true });
});
