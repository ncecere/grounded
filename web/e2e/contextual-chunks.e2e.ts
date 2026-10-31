import { expect, test } from "./support/fixtures";
import { createTeam, unique } from "./support/arrange";
import { fakeChatModel, fakeKey, fakeURL } from "./support/env";
import type { Schemas } from "./support/api";
import { scaled } from "../test-scale";

// Fake gateway only. The e2eserver explicitly enables this otherwise-off
// feature for its disposable database; no production models or keys are used.
test("contextual source consent, estimate, held preview and explicit switch-back", async ({ admin, as, a11y }) => {
  test.setTimeout(scaled(150_000));
  const team = await createTeam(admin, admin, { prefix: "contextual" });
  const base = `/v1/teams/${team}`;
  const source = await admin.post<Schemas["DataSource"]>(`${base}/sources`, { name: "Contextual handbook", classification: "open" });
  await admin.upload(team, source.id, [{ name: "handbook.md", body: "# Student handbook\n\n## Parking\n\nStudent parking permits are sold by the transportation office. Apply before the autumn term starts.\n\n## Library\n\nThe university library lends books to students and staff. Renew a loan before its due date.\n" }]);
  await expect.poll(async () => (await admin.get<Schemas["DocumentPage"]>(`${base}/sources/${source.id}/documents`)).items.map((d) => d.status), { timeout: scaled(30_000) }).toEqual(["ready"]);
  const kb = await admin.post<Schemas["KnowledgeBase"]>(`${base}/kbs`, { name: "Contextual handbook KB" });
  await admin.put(`${base}/kbs/${kb.id}/sources/${source.id}`);
  const liveProfile = (await admin.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`)).embeddingProfileId;
  // Separate connection/model identity: upstream+kind is unique per
  // connection, and shared seed pricing must remain unchanged for other specs.
  const connection = await admin.post<Schemas["Connection"]>("/v1/admin/connections", { name: unique("Contextual fake models"), baseUrl: fakeURL, apiKey: fakeKey });
  const model = await admin.post<Schemas["Model"]>("/v1/admin/models", { key: unique("ctx"), displayName: unique("Context writer"),
    connectionId: connection.id, upstreamModel: fakeChatModel, kind: "chat", maxClassification: "open", contextWindow: 32000 });
  // A dedicated model/rate avoids changing shared pricing while other specs run.
  await admin.post(`/v1/admin/models/${model.id}/prices`, { effectiveFrom: new Date().toISOString().slice(0, 10),
    prices: [{ unit: "chat_tokens_in", price: "1.000000" }, { unit: "chat_tokens_out", price: "1.000000" }] }, { expect: 201 });
  const statePath = `/v1/admin/sources/${source.id}/contextual`;
  const initial = await admin.get<Schemas["ContextualChunks"]>(statePath);
  expect(initial.platformEnabled).toBe(true);
  expect(initial.enabled).toBe(false);
  expect(initial.admission).toBeNull();

  const page = await as("admin");
  await page.goto(`${base.replace("/v1", "")}/sources/${source.id}`);
  await page.getByRole("button", { name: "Configure contextual chunks" }).click();
  const form = page.getByRole("dialog", { name: "Configure contextual chunks" });
  await form.getByRole("switch", { name: "Allow contextual index previews for this source" }).click();
  await expect(form.getByRole("button", { name: "Save contextual settings" })).toBeDisabled();
  await form.getByLabel("Context-writing chat model").selectOption(model.id);
  for (const [label, value] of [["Build token limit", "100000"], ["UTC-day token limit", "100000"], ["Build configured-price amount", "1.000000"], ["UTC-day configured-price amount", "1.000000"], ["Configured-price currency", "USD"]] as const) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await a11y(page, "contextual consent and explicit admission");
  await page.screenshot({ path: test.info().outputPath("contextual-consent-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await a11y(page, "contextual consent phone");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("contextual-consent-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await form.getByRole("button", { name: "Save contextual settings" }).click();
  await expect(form).not.toBeVisible();
  const saved = await admin.get<Schemas["ContextualChunks"]>(statePath);
  expect(saved.enabled).toBe(true);
  expect(saved.calls.attempts).toBe(0);
  expect(saved.cachedContexts).toBe(0);
  expect((await admin.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`)).embeddingProfileId).toBe(liveProfile);

  await page.getByRole("button", { name: "Estimate saved contextual settings" }).click();
  await expect(page.getByLabel("Saved contextual estimate")).toContainText("Configured-price estimate");
  await page.goto(`/admin/embedding-profiles?tab=migrations&preview=${kb.id}`);
  const preview = page.getByRole("dialog", { name: "Preview new settings" });
  const mode = preview.getByRole("combobox", { name: "Contextual embedding inputs" });
  await expect(mode).toBeEnabled();
  await mode.selectOption("on");
  const build = preview.getByRole("button", { name: "Build the new index" });
  await expect(build).toBeDisabled();
  await preview.getByRole("button", { name: "Estimate contextual work before building" }).click();
  await expect(build).toBeEnabled();
  await a11y(page, "contextual pre-build estimate");
  await page.screenshot({ path: test.info().outputPath("contextual-preview-estimate.png"), fullPage: true });
  await build.click();
  await expect(preview).not.toBeVisible();
  let migration: Schemas["ProfileMigration"] | undefined;
  await expect.poll(async () => {
    migration = (await admin.get<Schemas["ProfileMigration"][]>("/v1/admin/profile-migrations")).find((m) => m.kb.id === kb.id && m.hold);
    return migration?.status;
  }, { timeout: scaled(60_000) }).toBe("ready");
  const candidate = await admin.get<Schemas["EmbeddingProfile"]>(`/v1/admin/embedding-profiles/${migration!.toProfile.id}`);
  expect(candidate.contextual).toBe(true);
  const built = await admin.get<Schemas["ContextualChunks"]>(statePath);
  expect(built.calls.attempts).toBeGreaterThan(0);
  expect(built.cachedContexts).toBeGreaterThan(0);
  expect((await admin.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`)).embeddingProfileId).toBe(liveProfile);
  await expect(page.getByRole("button", { name: "Switch to the new index" })).toBeVisible({ timeout: scaled(15_000) });
  await page.getByRole("button", { name: "Switch to the new index" }).click();
  const switching = page.getByRole("alertdialog", { name: `Switch ${kb.name} to the new index?` });
  await switching.getByRole("button", { name: "Switch", exact: true }).click();
  await expect.poll(async () => (await admin.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`)).embeddingProfileId).toBe(migration!.toProfile.id);
  await page.getByRole("button", { name: "Switch back", exact: true }).click();
  const rollback = page.getByRole("alertdialog", { name: `Switch ${kb.name} back to ${migration!.fromProfile.name}?` });
  await rollback.getByRole("button", { name: "Switch back", exact: true }).click();
  await expect.poll(async () => (await admin.get<Schemas["KnowledgeBase"]>(`${base}/kbs/${kb.id}`)).embeddingProfileId).toBe(liveProfile);
  await a11y(page, "contextual explicit rollback");
  await page.screenshot({ path: test.info().outputPath("contextual-rollback.png"), fullPage: true });
});
