import { Api } from "./support/api";
import { createTeam } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * A save conflict on a settings form (v0.4.2 AD-01): the same team's
 * settings open in two tabs; the second tab's save finds the first tab's
 * change, keeps what was typed, lists what changed and saves over it on
 * purpose with "Overwrite with mine".
 */
test("a save conflict keeps what was typed and overwrites on purpose", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "conflict" });
  await owner.dispose();

  const tabA = await as("admin");
  const tabB = await as("admin");
  for (const tab of [tabA, tabB]) {
    await tab.goto(`/admin/teams/${team}?tab=settings`);
    await expect(tab.getByRole("textbox", { name: /Description/ })).toBeVisible();
  }
  await a11y(tabA);

  await tabB.getByRole("textbox", { name: /Description/ }).fill("Desc B");
  await tabB.getByRole("button", { name: "Save settings" }).click();
  await expect(tabB.getByRole("button", { name: "Save settings" })).toBeHidden();

  await tabA.getByRole("textbox", { name: /Description/ }).fill("Desc A2 important");
  await tabA.getByRole("button", { name: "Save settings" }).click();
  const changed = tabA.getByRole("list", { name: "Changed elsewhere" });
  await expect(changed).toContainText("now “Desc B” (yours: “Desc A2 important”)");
  await expect(tabA.getByRole("textbox", { name: /Description/ })).toHaveValue("Desc A2 important");
  await a11y(tabA, "save conflict");

  await tabA.getByRole("button", { name: "Overwrite with mine" }).click();
  await expect(changed).toBeHidden();
  await expect(tabA.getByRole("button", { name: "Save settings" })).toBeHidden();
  const saved = await admin.get<{ team: { description: string } }>(`/v1/admin/teams/${team}`);
  expect(saved.team.description).toBe("Desc A2 important");
});

/*
 * Admin → Settings and Costs → Settings write one record (re-test AD2-01, AD2-08): a threshold saved on Costs while
 * the currency is typed on Settings is listed by name and page, the typed currency stays, and Overwrite saves both.
 */
test("Admin → Settings keeps the typed currency through a save conflict with Costs → Settings", async ({ as, admin, a11y }) => {
  type Costs = { currency: string; warnPercent: number; mode: string; timeZone: string; defaultBudget: string | null; revision: number };
  const before = await admin.get<Costs>("/v1/admin/costs/settings");
  const settings = await as("admin");
  const costs = await as("admin");
  try {
    await settings.goto("/admin/settings");
    await costs.goto("/admin/costs?tab=settings");
    const currency = settings.getByRole("textbox", { name: "Currency" });
    await expect(currency).toHaveValue(before.currency);
    const threshold = costs.getByRole("textbox", { name: /Warning threshold/ });
    await expect(threshold).toBeVisible();

    const otherThreshold = before.warnPercent === 81 ? 82 : 81;
    await threshold.fill(String(otherThreshold));
    await costs.getByRole("button", { name: "Save settings" }).click();
    await expect(costs.getByRole("button", { name: "Save settings" })).toBeHidden();

    const otherCurrency = before.currency === "EUR" ? "GBP" : "EUR";
    await currency.fill(otherCurrency);
    await settings.getByRole("button", { name: "Save settings" }).click();
    const changed = settings.getByRole("list", { name: "Changed elsewhere" });
    await expect(changed).toContainText(`now “${otherThreshold}” (changed on Costs → Settings; your save keeps it)`);
    await expect(currency).toHaveValue(otherCurrency);
    await a11y(settings, "settings conflict");

    await settings.getByRole("button", { name: "Overwrite with mine" }).click();
    await expect(changed).toBeHidden();
    await expect(settings.getByRole("button", { name: "Save settings" })).toBeHidden();
    const saved = await admin.get<Costs>("/v1/admin/costs/settings");
    expect(saved).toMatchObject({ currency: otherCurrency, warnPercent: otherThreshold });
  } finally {
    const { mode, warnPercent, currency, timeZone, defaultBudget } = before;
    await admin.putRevised("/v1/admin/costs/settings", { mode, warnPercent, currency, timeZone, defaultBudget });
  }
});
