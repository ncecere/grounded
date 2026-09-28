import { Api } from "./support/api";
import { createTeam, unique } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/** Team settings as the owner: members and invites, usage, API keys and the audit log. */
test("team settings: invite, usage meters, API key shown once and revoked, audit record", async ({ as, admin, a11y }) => {
  const owner = await Api.signIn("blair");
  const team = await createTeam(admin, owner, { prefix: "settings" });
  await owner.dispose();
  const page = await as("blair");
  const tabs = page.getByRole("tablist", { name: "Team settings sections" });

  await test.step("invite someone who hasn't signed in yet", async () => {
    await page.goto(`/teams/${team}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Team settings" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Blair Dev/ })).toBeVisible();
    await a11y(page);

    const email = `${unique("invitee")}@example.test`;
    await page.getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog", { name: "Add member" });
    await dialog.getByLabel("Email address").fill(email);
    await dialog.getByLabel("Role").selectOption("editor");
    await a11y(page, "add a member");
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog.getByText(`An invite was created for ${email}`)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Open invites" }).getByText(email)).toBeVisible();
  });

  await test.step("usage meters", async () => {
    await tabs.getByRole("tab", { name: "Usage & limits" }).click();
    await expect(page).toHaveURL(/tab=usage/);
    await expect(page.getByRole("meter").first()).toBeVisible();
    await a11y(page);
  });

  await test.step("an API key's secret is shown once; revoking removes the key", async () => {
    await tabs.getByRole("tab", { name: "API keys" }).click();
    await expect(page).toHaveURL(/tab=api-keys/);
    await expect(page.getByText("No API keys yet.")).toBeVisible();
    await a11y(page);

    await page.getByRole("button", { name: "New API key" }).first().click();
    const create = page.getByRole("dialog", { name: "New API key" });
    await create.getByLabel("Name").fill("Course site search");
    await create.getByRole("group", { name: "Scopes" }).getByRole("checkbox").first().check();
    await a11y(page, "new API key");
    await create.getByRole("button", { name: "Create key" }).click();

    const created = page.getByRole("dialog", { name: "API key created" });
    await expect(created.getByText("Copy this key now.")).toBeVisible();
    const secret = (await created.getByRole("group", { name: "Secret" }).locator("code").textContent()) ?? "";
    expect(secret.length).toBeGreaterThan(20);
    await a11y(page, "API key created");
    await created.getByRole("button", { name: "Done" }).click();

    // The list and the key's record show its prefix, never the secret again.
    const row = page.getByRole("row", { name: /Course site search/ });
    await expect(row).toBeVisible();
    await expect(page.getByText(secret)).toHaveCount(0);
    await row.getByRole("rowheader").click();
    const sheet = page.getByRole("region", { name: "Course site search" });
    await expect(sheet.getByText("Its secret was shown once")).toBeVisible();
    await expect(sheet.getByText(secret)).toHaveCount(0);
    await a11y(page, "API key record");

    await sheet.getByRole("button", { name: "Revoke key" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Revoke Course site search?" });
    await a11y(page, "revoke confirmation");
    await confirm.getByRole("button", { name: "Revoke key" }).click();
    await expect(confirm).toBeHidden();
    // Revoking closes the key's page and returns to the list.
    await expect(page.getByText("No API keys yet.")).toBeVisible();
  });

  await test.step("the audit log and an entry's record page", async () => {
    await tabs.getByRole("tab", { name: "Audit log" }).click();
    await expect(page).toHaveURL(/tab=audit/);
    const entry = page.getByRole("row", { name: /Revoked API key/ });
    await expect(entry).toBeVisible();
    await a11y(page);
    await entry.click();
    const record = page.getByRole("region", { name: "Revoked API key" });
    await expect(record).toBeVisible();
    await expect(page).toHaveURL(/record=/);
    await a11y(page, "audit record");
  });
});
