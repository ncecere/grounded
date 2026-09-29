import { Api, type Schemas } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

/*
 * Costs and budgets (E2): the admin prices the chat model and gives a team a
 * tiny budget in Enforce; a chat succeeds, the next is refused with the
 * budget message; an extension lets the team chat again. The platform mode
 * stays Off, so only this team is enforced (its own mode) and other specs are
 * unaffected; prices are dated long ago so today's usage is priced in any
 * time zone.
 */
test("price a model, enforce a tiny budget, get refused, grant an extension", async ({ as, admin, a11y }) => {
  test.setTimeout(120_000);
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "costs" });
  const { agent } = await publishedAgent(owner, team, { name: "Budget helper" });
  await owner.dispose();
  // The team's own mode, so its Budget card shows while the platform is Off.
  await admin.putRevised(`/v1/admin/teams/${team}/budget`, { mode: "track", amount: null, warnPercent: null });
  const models = await admin.get<Schemas["Model"][]>("/v1/admin/models");
  const chat = models.find((m) => m.displayName === "E2E chat");
  if (!chat) throw new Error("the seed's chat model is missing");

  const adminPage = await as("admin");
  await test.step("price the chat model", async () => {
    await adminPage.goto("/admin/costs?tab=prices");
    await expect(adminPage.getByRole("heading", { level: 1, name: "Costs" })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "E2E chat" })).toBeVisible();
    await a11y(adminPage);
    await adminPage.getByRole("link", { name: "E2E chat" }).click();
    await expect(adminPage.getByRole("heading", { name: "Pricing" })).toBeVisible();
    // Opened from Costs, the model's page leads back there.
    await expect(adminPage.getByRole("link", { name: "Back to Costs" })).toBeVisible();
    await a11y(adminPage);
    await adminPage.getByRole("button", { name: "Change prices" }).click();
    const dialog = adminPage.getByRole("dialog", { name: "Change prices of E2E chat" });
    await dialog.getByLabel("Effective from").fill("2020-01-01");
    await dialog.getByLabel(/^Input tokens/).fill("1000000");
    await dialog.getByLabel(/^Output tokens/).fill("1000000");
    await a11y(adminPage, "change prices");
    await dialog.getByRole("button", { name: "Save prices" }).click();
    await expect(dialog).toBeHidden();
    await expect(adminPage.getByRole("table", { name: "Price history" })).toContainText("Input tokens");
    await adminPage.getByRole("link", { name: "Back to Costs" }).click();
    await expect(adminPage.getByRole("tab", { name: "Prices", selected: true })).toBeVisible();
  });

  await test.step("give the team a tiny budget in Enforce", async () => {
    // The Budget card is on the team's Overview (v0.2.1 I7).
    await adminPage.goto(`/admin/teams/${team}`);
    await expect(adminPage.getByRole("button", { name: "Change budget" })).toBeVisible();
    await a11y(adminPage);
    await adminPage.getByRole("button", { name: "Change budget" }).click();
    const dialog = adminPage.getByRole("dialog", { name: /^Budget of / });
    await dialog.getByLabel("Cost tracking").selectOption("enforce");
    await dialog.getByLabel(/^Monthly budget/).fill("1");
    await a11y(adminPage, "change budget");
    await dialog.getByRole("button", { name: "Save budget" }).click();
    await expect(dialog).toBeHidden();
    await expect(adminPage.getByText("Team setting", { exact: true })).toBeVisible();
    await expect(adminPage.getByText("Budget this month")).toBeVisible();
  });

  const page = await as("alex");
  const composer = page.getByRole("textbox", { name: "Message Budget helper" });
  const ask = async () => {
    const res = page.waitForResponse((r) => r.url().endsWith(`/v1/agents/${team}/${agent.slug}/chat`));
    await composer.fill("How much is a student parking permit?");
    await composer.press("Enter");
    return res;
  };

  await test.step("a chat succeeds, then the next is refused", async () => {
    await page.goto(`/a/${team}/${agent.slug}`);
    await expect(composer).toBeEnabled();
    await a11y(page);
    expect((await ask()).status()).toBe(200);
    // The answer is complete once its feedback buttons show.
    await expect(page.getByRole("article", { name: "Budget helper said" }).getByRole("button", { name: "Good answer" })).toBeVisible();
    expect((await ask()).status()).toBe(429);
    await expect(page.getByText("The team's monthly budget is used up", { exact: true })).toBeVisible();
    await a11y(page, "refused for the budget");
  });

  await test.step("the admin grants an extension", async () => {
    await adminPage.reload();
    await expect(adminPage.getByText("Budget used up")).toBeVisible();
    await adminPage.getByRole("button", { name: "Grant extension" }).click();
    const dialog = adminPage.getByRole("dialog", { name: /an extension$/ });
    await dialog.getByLabel(/^Amount/).fill("1000000");
    await dialog.getByLabel("Reason").fill("Exam period");
    await a11y(adminPage, "grant extension");
    await dialog.getByRole("button", { name: "Grant extension" }).click();
    await expect(dialog).toBeHidden();
    await expect(adminPage.getByRole("table", { name: "Extensions this month" })).toContainText("Exam period");
    // The budget in force counts the extension, as the Budgets tab does.
    await expect(adminPage.getByText(/of extensions\)$/)).toBeVisible();
    await a11y(adminPage, "after the extension");
  });

  await test.step("chat works again", async () => {
    expect((await ask()).status()).toBe(200);
    await expect(page.getByRole("article", { name: "Budget helper said" }).getByRole("button", { name: "Good answer" })).toHaveCount(2);
    await a11y(page, "after the extension");
  });
});
