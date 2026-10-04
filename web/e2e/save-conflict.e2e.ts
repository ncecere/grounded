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
