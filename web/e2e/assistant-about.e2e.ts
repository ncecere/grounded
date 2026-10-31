import { baseURL } from "./support/env";
import { Api, type Schemas } from "./support/api";
import { createTeam, publishedAgent } from "./support/arrange";
import { expect, test } from "./support/fixtures";

// Real serve + PG + Valkey + source-pinned fake models from e2eserver.
// No route interception: each disclosure is returned by the application.
test("published disclosures on public, signed-in and widget surfaces", async ({ page, as, admin, a11y }, info) => {
  const owner = await Api.signIn("alex");
  try {
    const team = await createTeam(admin, owner, { prefix: "about" });
    const { agent } = await publishedAgent(owner, team, {
      name: "About helper", audience: "public", config: { ownershipNote: "Published owner note" },
    });
    const edit = `/v1/teams/${team}/agents/${agent.id}`;
    const current = await owner.get<Schemas["Agent"]>(edit);
    await owner.patch(edit, { config: { ...current.draft, ownershipNote: "Private draft note" } },
      { headers: { "If-Match": `"${current.revision}"` } });
    const { key } = await owner.post<Schemas["PublishableKeyCreated"]>(`${edit}/publishable-keys`, {
      name: "About widget", allowedOrigins: [baseURL],
    });
    const signed = await as("alex");
    for (const [surface, p, path] of [
      ["public", page, `/a/${team}/about-helper`],
      ["signed-in", signed, `/a/${team}/about-helper`],
      ["widget", page, `/embed/${agent.id}?key=${key}`],
    ] as const) {
      await p.setViewportSize({ width: 390, height: 844 });
      const work: string[] = [];
      const listener = (r: import("@playwright/test").Request) => {
        if (/\/(chat|retrieve|documents|probe|test)(\?|$)/.test(new URL(r.url()).pathname)) work.push(r.url());
      };
      p.on("request", listener);
      await p.goto(path);
      const trigger = p.getByRole("button", { name: "About this assistant" });
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await p.keyboard.press("Enter");
      const dialog = p.getByRole("dialog", { name: "About this assistant" });
      await expect(dialog).toContainText("Published owner note");
      await expect(dialog).not.toContainText("Private draft note");
      await expect(dialog.getByText("About this assistant", { exact: true })).toBeFocused();
      await a11y(p, `${surface} About 390px`);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await p.screenshot({ path: info.outputPath(`${surface}-390.png`) });
      await p.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(work).toEqual([]);
      p.off("request", listener);
    }
    await owner.post(`${edit}/publish`, {}, { expect: 201 });
    await page.goto(`/a/${team}/about-helper`);
    await page.getByRole("button", { name: "About this assistant" }).click();
    await expect(page.getByRole("dialog")).toContainText("Private draft note");
    await a11y(page);
    await owner.post(`${edit}/status`, { status: "disabled_by_team" });
    await page.reload();
    await expect(page.getByRole("button", { name: "About this assistant" })).toHaveCount(0);
    await a11y(page);
  } finally { await owner.dispose(); }
});

test("statement admin editor and auditor read boundary use live revisioned settings", async ({ as, admin, a11y }, info) => {
  const p = await as("admin");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto("/accessibility");
  const path = "/v1/admin/settings/accessibility";
  const before = await admin.get<Schemas["AccessibilitySettings"]>(path);
  const saved = p.waitForResponse(r => r.url().endsWith(path) && r.request().method() === "PUT");
  await p.getByLabel("Reporting contact URL").fill("mailto:about@example.edu");
  await p.getByLabel("Institution statement URL").fill("https://example.edu/accessibility");
  await p.getByRole("button", { name: "Save statement links" }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  expect(res.request().headers()["if-match"]).toBe(`"${before.revision}"`);
  await expect(p.getByRole("link", { name: "Contact the platform support team" })).toHaveAttribute("href", "mailto:about@example.edu");
  await a11y(p);
  await p.screenshot({ path: info.outputPath("statement-admin-390.png") });
  await admin.put(path, { contactUrl: "", institutionUrl: "" }, { headers: { "If-Match": `"${before.revision}"` }, expect: 412 });
  const current = await admin.get<Schemas["AccessibilitySettings"]>(path);
  await admin.put(path, { contactUrl: "javascript:alert(1)", institutionUrl: "" }, { headers: { "If-Match": `"${current.revision}"` }, expect: 400 });
  const auditor = await Api.signIn("auditor");
  try {
    await auditor.get(path);
    await auditor.put(path, { contactUrl: "", institutionUrl: "" }, { headers: { "If-Match": `"${current.revision}"` }, expect: 403 });
    const read = await as("auditor");
    await read.goto("/accessibility");
    await expect(read.getByRole("link", { name: "Contact the platform support team" })).toHaveAttribute("href", "mailto:about@example.edu");
    await expect(read.getByLabel("Reporting contact URL")).toHaveCount(0);
    await a11y(read);
  } finally { await auditor.dispose(); }
});
