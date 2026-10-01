import { expect as pollExpect } from "@playwright/test";
import { Api, type Schemas } from "../support/api";
import { createTeam } from "../support/arrange";
import { expect, test } from "../support/fixtures";

/*
 * Cross-encoder reranking (docs/v0.4.0.md §3) reranks every search once a
 * platform admin chooses a rerank model, so this spec is in the "platform"
 * project, which runs after the parallel specs, one at a time. The fake
 * gateway's fake-reranker scores a passage by the question's words it
 * contains; FAKE-RERANK-TOP pins one first.
 */

const docs = [
  { name: "fees.md", body: "Transcript fee: an official transcript costs ten dollars per copy. Transcript fee transcript fee.\n" },
  { name: "ordering.md", body: "FAKE-RERANK-TOP Order transcripts online from the registrar.\n" },
];

test.afterEach(async ({ admin }) => {
  // Never leave searches reranked for the next spec, whatever happened.
  const st = await admin.get<Schemas["RerankSettings"]>("/v1/admin/rerank");
  if (st.modelId) await admin.putRevised("/v1/admin/rerank", { modelId: null, candidates: st.candidates, timeLimitMs: st.timeLimitMs });
});

test("reranking: an admin chooses the rerank model; Try it shows the reranked order and compares", async ({ as, admin, a11y }) => {
  const conns = await admin.get<Schemas["Connection"][]>("/v1/admin/connections");
  const conn = conns.find((c) => c.name === "E2E fake models");
  if (!conn) throw new Error("the seed's connection is missing");
  const models = await admin.get<Schemas["Model"][]>("/v1/admin/models");
  if (!models.some((m) => m.key === "e2e-rerank")) {
    await admin.post("/v1/admin/models", {
      connectionId: conn.id, key: "e2e-rerank", upstreamModel: "fake-reranker", displayName: "E2E reranker", kind: "rerank", maxClassification: "restricted",
    });
  }
  const owner = await Api.signIn("alex");
  const team = await createTeam(admin, owner, { prefix: "rerank" });
  const base = `/v1/teams/${team}`;
  const src = await owner.post<Schemas["DataSource"]>(`${base}/sources`, { name: "Registrar", classification: "open" });
  await owner.upload(team, src.id, docs);
  await pollExpect
    .poll(async () => (await owner.get<Schemas["DocumentPage"]>(`${base}/sources/${src.id}/documents`)).items.map((d) => d.status), { timeout: 30_000 })
    .toEqual(["ready", "ready"]);
  const kb = await owner.post<Schemas["KnowledgeBase"]>(`${base}/kbs`, { name: "Registrar help", topK: 2 });
  await owner.put(`${base}/kbs/${kb.id}/sources/${src.id}`);
  await owner.dispose();

  const adminPage = await as("admin");
  await test.step("the admin chooses the rerank model", async () => {
    await adminPage.goto("/admin/models");
    await expect(adminPage.getByText("Reranking is off")).toBeVisible();
    await adminPage.getByRole("button", { name: "Reranking settings" }).click();
    const dialog = adminPage.getByRole("dialog", { name: "Reranking settings" });
    await dialog.getByLabel("Rerank model").selectOption({ label: "E2E reranker (fake-reranker)" });
    await a11y(adminPage, "reranking settings");
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText(/Searches rerank their best 40 passages with E2E reranker/)).toBeVisible();
    await a11y(adminPage, "models with reranking");
  });

  const page = await as("alex");
  await test.step("Try it shows the reranked order with scores", async () => {
    await page.goto(`/teams/${team}/kbs/${kb.id}?tab=try`);
    await page.getByRole("textbox", { name: "Question or search terms" }).fill("transcript fee");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/Reranked the best 2 passages in/)).toBeVisible();
    const cards = page.getByRole("list", { name: "Search results" }).getByRole("article");
    await expect(cards.first()).toContainText("FAKE-RERANK-TOP");
    await expect(cards.first()).toContainText("Rerank 1.000");
    await a11y(page, "reranked results");
  });

  await test.step("turning Rerank off compares with the usual order", async () => {
    await page.getByRole("switch", { name: /Rerank/ }).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/Reranked the best/)).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Search results" }).getByRole("article").first()).not.toContainText("Rerank 1.000");
  });
});
