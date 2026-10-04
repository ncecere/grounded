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

test("reranking: an admin sets it up on Admin → Models → Reranking, tests it there; Try it shows the reranked order and compares", async ({ as, admin, a11y }) => {
  // The setup path starts with no rerank model (an earlier run's is removed; afterEach turned reranking off).
  for (const m of await admin.get<Schemas["Model"][]>("/v1/admin/models")) {
    if (m.key === "e2e-rerank") await admin.del(`/v1/admin/models/${m.id}`);
  }
  const owner = await Api.signIn("alex");
  // The admin is a member, so the Reranking page's test can search the team's knowledge base (ADR-0011).
  const team = await createTeam(admin, owner, { prefix: "rerank", members: { admin: "member" } });
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
  await test.step("the guide leads to Add model with kind Rerank", async () => {
    await adminPage.goto("/admin");
    await a11y(adminPage, "overview");
    // Features: "Reranking · Off" with Set up (the only row with that link).
    await adminPage.locator("#features").getByRole("link", { name: "Set up", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/admin\/reranking$/);
    const guide = adminPage.getByRole("region", { name: "Set up reranking" });
    await expect(guide.getByText("1 of 3 done")).toBeVisible();
    await a11y(adminPage, "reranking setup guide");
    await guide.getByRole("link", { name: "Add model" }).click();
    // The form's sections (the list behind it has Kind and Connection filters too).
    const source = adminPage.getByRole("group", { name: "Source" });
    await expect(source.getByLabel("Kind")).toHaveValue("rerank");
    await a11y(adminPage, "add rerank model");
    await source.getByLabel("Connection").selectOption({ label: "E2E fake models" });
    await source.getByLabel("Upstream model ID").fill("fake-reranker");
    await source.getByLabel("Key").fill("e2e-rerank");
    await adminPage.getByRole("group", { name: "Identity" }).getByLabel("Display name").fill("E2E reranker");
    await adminPage.getByRole("button", { name: "Add model" }).click();
    await expect(adminPage).toHaveURL(/\/admin\/reranking$/);
  });

  await test.step("choosing a model that was never tested asks first, then searches rerank", async () => {
    // The guide stays until a model is chosen, its last step now current (AD2-06).
    const guide = adminPage.getByRole("region", { name: "Set up reranking" });
    await expect(guide.getByText("2 of 3 done")).toBeVisible();
    await expect(guide.getByRole("link", { name: "Choose the model" })).toBeVisible();
    await adminPage.getByLabel("Rerank model").selectOption({ label: "E2E reranker (fake-reranker) · Not tested" });
    await expect(adminPage.getByText(/E2E reranker hasn't been tested/)).toBeVisible();
    await a11y(adminPage, "reranking settings");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await adminPage.getByRole("alertdialog", { name: "Rerank with E2E reranker?" }).getByRole("button", { name: "Save anyway" }).click();
    await expect(adminPage.getByRole("region", { name: "Status" }).getByText("On", { exact: true })).toBeVisible();
    await expect(guide).toHaveCount(0);
  });

  await test.step("the page's test compares the usual order with the reranked one", async () => {
    await adminPage.getByLabel("Team").selectOption({ label: `E2E ${team}` });
    await expect(adminPage.getByLabel("Knowledge base")).toHaveValue(kb.id);
    await adminPage.getByLabel("Question").fill("transcript fee");
    await adminPage.getByRole("button", { name: "Compare" }).click();
    await expect(adminPage.getByText(/Reranked the best 2 passages in/)).toBeVisible();
    await expect(adminPage.getByRole("list", { name: "Reranked" }).getByRole("listitem").first()).toContainText("FAKE-RERANK-TOP");
    await expect(adminPage.getByRole("list", { name: "Usual order" }).getByRole("listitem").first()).not.toContainText("FAKE-RERANK-TOP");
    await a11y(adminPage, "reranking test");
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
