/* Index preview (#18, T5): Preview new settings…, the held migration's page with its comparison, Switch and Discard, and the team's view. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { mockApi, Reply, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

type Migration = Schemas["ProfileMigration"];
type Comparison = Schemas["ProfileMigrationComparison"];

const estimate: Schemas["ProfileMigrationEstimate"] = { documents: 40, passages: 320, tokens: 51200, embeddingCalls: 5, requestsPerMinute: 110, minutes: 0.05, rechunk: true };
const held: Migration = {
  id: "m9",
  status: "ready",
  hold: true,
  canSwitch: true,
  kb: { id: "k1", name: "Student handbook" },
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  fromProfile: { id: "p1", name: "Nomic 768" },
  toProfile: { id: "p9", name: "Nomic 768 (new settings)" },
  graceDays: 7,
  estimate,
  startedAt: "2026-10-14T09:00:00Z",
  startedBy: { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" },
  switchedAt: null,
  oldVectorsUntil: null,
  finishedAt: null,
  canSwitchBack: false,
  progress: { sources: 2, sourcesComplete: 2, documents: 40, done: 40, failed: 0, waiting: 0 },
  revision: 6,
};
const building: Migration = { ...held, status: "running", canSwitch: false, progress: { sources: 2, sourcesComplete: 1, documents: 40, done: 12, failed: 0, waiting: 0 } };

const summary = (recall: number, mrr: number, passed: number, questions = 10): Schemas["EvaluationSummary"] => ({
  k: 8, questions, passed, failed: questions - passed, missing: 0, notIndexed: 0, errors: 0, cited: 0, citedOnly: 0, refused: 0, recall, mrr,
});
const side = (recall: number, mrr: number, firstPlace: number, passed: number, status: "completed" | "running" = "completed", questions = 10): NonNullable<Comparison["sets"][number]["live"]> => ({
  runId: "r-" + recall, status, createdAt: "2026-10-14T10:00:00Z", summary: summary(recall, mrr, passed, questions), firstPlace,
});
const set = (name: string, over: Partial<Comparison["sets"][number]> = {}): Comparison["sets"][number] => ({
  setId: "s-" + name, name, questions: 10, live: side(0.9, 0.8, 7, 9), candidate: side(0.95, 0.85, 8, 10), better: 2, worse: 1, same: 7, unscored: 0, ...over,
});
const comparison = (over: Partial<Comparison> = {}): Comparison => ({
  migrationId: "m9",
  status: "ready",
  running: false,
  sets: [set("Admissions questions"), set("Housing", { questions: 6, better: 0, worse: 0, same: 6, live: side(1, 1, 6, 6, "completed", 6), candidate: side(1, 1, 6, 6, "completed", 6) })],
  totals: { sets: 2, questions: 16, live: summary(0.94, 0.88, 15, 16), candidate: summary(0.97, 0.91, 16, 16), liveFirstPlace: 13, candidateFirstPlace: 14, better: 2, worse: 1, same: 13 },
  ...over,
});

const profile = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, key: id, name, description: "", model: { id: "m-" + id, displayName: name + " model", maxClassification: "restricted" }, dimensions: 768, storageType: "halfvec",
  documentPrefix: "", queryPrefix: "", chunkSize: 512, chunkOverlap: 64, chunkerVersion: 1, status: "active", isDefault: id === "p1", revision: 1, createdAt: "", updatedAt: "", ...over,
});
const kbs = [{ id: "k1", name: "Student handbook", teamSlug: "registrar", teamName: "Office of the Registrar", profile: { id: "p1", name: "Nomic 768" }, sources: 2, passages: 320, migration: null }];

const routes = (extra: Record<string, (b: unknown) => unknown> = {}) => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/profile-migrations": () => [held],
  "GET /v1/admin/profile-migrations/m9": () => held,
  "GET /v1/admin/profile-migrations/m9/preview": () => comparison(),
  "GET /v1/admin/knowledge-bases": () => kbs,
  "GET /v1/admin/embedding-profiles": () => [profile("p1", "Nomic 768"), profile("p2", "Qwen3 768")],
  "GET /v1/admin/models": () => [
    { id: "m-p1", displayName: "Nomic embed", kind: "embedding", enabled: true },
    { id: "m-p2", displayName: "Qwen3 embed", kind: "embedding", enabled: true },
    { id: "m-chat", displayName: "A chat model", kind: "chat", enabled: true },
  ],
  ...extra,
});

describe("Preview new settings", () => {
  it("builds a new index with only the settings that were filled in, then opens the preview", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/preview": () => building, "GET /v1/admin/profile-migrations/m9": () => building }));
    const { container } = renderApp("/admin/embedding-profiles?tab=migrations");
    await userEvent.click(await screen.findByRole("button", { name: "Preview new settings…" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" });
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    const submit = within(dialog).getByRole("button", { name: "Build the new index" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Knowledge base" }), "k1");
    expect(await within(dialog).findByText(/Now: Nomic 768 · 512 tokens per passage, 64 overlap/)).toBeInTheDocument();
    // Only embedding models are offered, and not the current one.
    const model = within(dialog).getByRole("combobox", { name: "Embedding model" });
    expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep Nomic 768 model", "Qwen3 embed"]);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Passage size/ }), "256");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Passage overlap/ }), "32");
    await userEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: { chunkSize: 256, chunkOverlap: 32 } });
    // The new preview's page opens, saying the index is still being built.
    expect(await screen.findByRole("region", { name: /Student handbook: Nomic 768 → Nomic 768 \(new settings\)/ })).toBeInTheDocument();
    expect(await screen.findByText("The new index is still being built")).toBeInTheDocument();
  });

  it("sends the chunker only when one is chosen, and says which one the knowledge base has now (#19)", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/preview": () => building, "GET /v1/admin/profile-migrations/m9": () => building }));
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    expect(await within(dialog).findByText(/512 tokens per passage, 64 overlap, standard chunker/)).toBeInTheDocument();
    const chunker = within(dialog).getByRole("combobox", { name: "Chunker" });
    expect(chunker).toHaveValue("");
    expect(within(chunker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Keep the current chunker",
      "Standard: a new passage at every heading",
      "Merge short sections",
    ]);
    await userEvent.selectOptions(chunker, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Build the new index" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: { chunkerVersion: 2 } });
  });

  it("sends near-duplicate matching only when it is chosen, and the dialog has no accessibility violations (#23)", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/preview": () => building, "GET /v1/admin/profile-migrations/m9": () => building }));
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    const field = await within(dialog).findByRole("combobox", { name: "Repeated blocks" });
    expect(field).toHaveValue("");
    expect(within(field).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep each source's setting", "Treat near-duplicate blocks as one"]);
    // Left alone, it changes nothing: the dialog still says the new index would be identical.
    expect(within(dialog).getByText(/Nothing is filled in, so the new index will be identical/)).toBeInTheDocument();
    await userEvent.selectOptions(field, "on");
    expect(within(dialog).queryByText(/Nothing is filled in/)).not.toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Build the new index" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/preview")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/admin/profile-migrations/preview")!.body).toEqual({ kbId: "k1", changes: { boilerplateFuzzy: true } });
  });

  it("says when the knowledge base already uses the merging chunker", async () => {
    mockApi(routes({ "GET /v1/admin/embedding-profiles": () => [profile("p1", "Nomic 768", { chunkerVersion: 2 }), profile("p2", "Qwen3 768")] }));
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    expect(await within(dialog).findByText(/overlap, chunker: merge short sections/)).toBeInTheDocument();
  });

  it("says when nothing is filled in, and keeps the header's one primary", async () => {
    mockApi(routes());
    renderApp("/admin/embedding-profiles?tab=migrations&preview=k1");
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    expect(await within(dialog).findByText(/Nothing is filled in, so the new index will be identical/)).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Knowledge base" })).toHaveValue("k1");
  });

  it("on a phone the header keeps one button, and Preview new settings… is in the … menu", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    mockApi(routes());
    renderApp("/admin/embedding-profiles?tab=migrations");
    await screen.findByRole("button", { name: "Migrate a knowledge base" }, { timeout: scaled(4000) });
    expect(screen.queryByRole("button", { name: "Preview new settings…" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Preview new settings…" }));
    expect(await screen.findByRole("dialog", { name: "Preview new settings" })).toBeInTheDocument();
  });

  it("is for platform admins only", async () => {
    mockApi({ ...routes(), ...shellRoutes("platform_auditor") });
    renderApp("/admin/embedding-profiles?tab=migrations");
    await screen.findByRole("table", { name: "Profile migrations" }, { timeout: scaled(4000) });
    expect(screen.queryByRole("button", { name: "Preview new settings…" })).toBeNull();
  });
});

describe("A held migration's page", () => {
  it("shows the comparison per set and in all, and no question text", async () => {
    mockApi(routes());
    const { container } = renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook: Nomic 768 → Nomic 768 \(new settings\)/ }, { timeout: scaled(4000) });
    expect(within(sheet).getByText("Index preview: waits for you to switch")).toBeInTheDocument();
    const table = await within(sheet).findByRole("table", { name: /Current index → new index/ });
    // One header per column: the count and the changes are not both called "Questions".
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Evaluation set", "Questions", "Recall", "MRR", "Ranked first", "Changes"]);
    const row = within(table).getByText("Admissions questions").closest("tr")!;
    // From the current index to the new one, one cell each (the arrow between them is an icon named "to").
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(/^90%\s*95%$/);
    expect(cells[3]).toHaveTextContent(/^0\.80\s*0\.85$/);
    expect(cells[4]).toHaveTextContent(/^7\s*8$/);
    expect(cells[5]).toHaveTextContent("2 better");
    expect(cells[5]).toHaveTextContent("1 worse");
    expect(within(within(table).getByText("Housing").closest("tr")!).getAllByRole("cell")[5]).toHaveTextContent("6 unchanged");
    expect(within(within(table).getByText("All sets").closest("tr")!).getAllByRole("cell")[2]).toHaveTextContent(/^94%\s*97%$/);
    expect(within(row).getAllByLabelText("to").length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/the questions are on the knowledge base's page, for its editors/)).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });

  it("switches after a confirmation, with the revision it saw", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/m9/switch": () => ({ ...held, status: "switched", canSwitchBack: true, canSwitch: false, revision: 7 }) }));
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Switch to the new index" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Switch Student handbook to the new index?" });
    expect(confirm).toHaveTextContent("kept for 7 days");
    await userEvent.click(within(confirm).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/m9/switch"))?.headers.get("If-Match")).toBe('"6"'));
  });

  it("discards after a confirmation that says the record stays", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/m9/cancel": () => ({ ...held, status: "cancelled", canSwitch: false, revision: 7 }) }));
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Discard preview" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Discard the preview of Student handbook?" });
    expect(confirm).toHaveTextContent("The record of this preview stays");
    await userEvent.click(within(confirm).getByRole("button", { name: "Discard preview" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/m9/cancel"))?.headers.get("If-Match")).toBe('"6"'));
  });

  it("says there is nothing to compare for a knowledge base without evaluation sets, and still allows the decision", async () => {
    mockApi(routes({ "GET /v1/admin/profile-migrations/m9/preview": () => comparison({ sets: [], totals: { ...comparison().totals, sets: 0, questions: 0 } }) }));
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    expect(await within(sheet).findByText("Nothing to compare")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Switch to the new index" })).toBeEnabled();
  });

  it("keeps the last finished numbers while another comparison runs, and asks again with Compare again", async () => {
    let running = true;
    const calls = mockApi(
      routes({
        "GET /v1/admin/profile-migrations/m9/preview": () => comparison({ running }),
        "POST /v1/admin/profile-migrations/m9/evaluate": () => new Reply(202, { sets: 1 }),
      }),
    );
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    expect(await within(sheet).findByText("Comparing the two indexes…")).toBeInTheDocument();
    expect(within(sheet).getByText("The numbers below are from the last comparison that finished.")).toBeInTheDocument();
    expect(within(sheet).getByRole("table", { name: /Current index → new index/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Compare again" })).toBeDisabled();
    running = false;
    await waitFor(() => expect(within(sheet).queryByText("Comparing the two indexes…")).toBeNull(), { timeout: scaled(8000) });
    await userEvent.click(within(sheet).getByRole("button", { name: "Compare again" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/m9/evaluate"))).toBe(true));
  });

  it("says the index is still being built, and only offers to discard", async () => {
    mockApi(routes({ "GET /v1/admin/profile-migrations/m9": () => building, "GET /v1/admin/profile-migrations": () => [building] }));
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    expect(await within(sheet).findByText("The new index is still being built")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Discard preview" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Switch to the new index" })).toBeNull();
  });

  it("is read-only for auditors", async () => {
    mockApi({ ...routes(), ...shellRoutes("platform_auditor") });
    renderApp("/admin/embedding-profiles?tab=migrations&record=m9");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: scaled(4000) });
    await within(sheet).findByRole("table", { name: /Current index → new index/ });
    expect(within(sheet).queryByRole("button", { name: "Switch to the new index" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Discard preview" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Compare again" })).toBeNull();
  });
});

describe("The knowledge base's page for the team", () => {
  const kb: Schemas["KnowledgeBase"] = {
    id: "k1", name: "Student handbook", description: "", embeddingProfileId: "p1", topK: 8, sources: [{ id: "s1", name: "Policies", classification: "open", shared: false }],
    effectiveClassification: "open", revision: 2, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
  };
  const teamRoutes = (extra: Record<string, (b: unknown) => unknown> = {}) => ({
    ...shellRoutes("none", "editor"),
    "GET /v1/teams/registrar/kbs/k1": () => kb,
    "GET /v1/teams/registrar/kbs/k1/profile-migration": () => held,
    "GET /v1/teams/registrar/sources": () => [],
    "GET /v1/shared-sources": () => [],
    "GET /v1/teams/registrar/agents": () => [],
    ...extra,
  });
  const withQuestions = comparison({
    sets: [
      set("Admissions questions", {
        items: [
          { caseId: "c1", question: "What is the application deadline?", change: "same", liveStatus: "pass", candidateStatus: "pass", liveRank: 1, candidateRank: 1 },
          { caseId: "c2", question: "How do I request a transcript?", change: "better", liveStatus: "fail", candidateStatus: "pass", liveRank: null, candidateRank: 2 },
          { caseId: "c3", question: "Where do I park?", change: "worse", liveStatus: "pass", candidateStatus: "fail", liveRank: 1, candidateRank: null },
        ],
      }),
    ],
  });

  it("tells an editor what a ready preview changed for each question, worst first, and says nothing changes for them yet", async () => {
    mockApi(teamRoutes({ "GET /v1/teams/registrar/kbs/k1/index-preview": () => withQuestions }));
    const { container } = renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByText("A platform admin is trying new index settings on this knowledge base", {}, { timeout: scaled(4000) })).toBeInTheDocument();
    // The notice does not repeat the new index's name (a name such as "Nomic 768 (new settings)" read as nested parentheses).
    expect(screen.getByText("The new index is built. Search and agents still use Nomic 768 until the platform admin switches. Your evaluation sets were run on both; what changed is below.")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Questions that changed in Admissions questions" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Where do I park?#1not foundWorse");
    expect(rows[1]).toHaveTextContent("How do I request a transcript?not found#2Better");
    expect(rows).toHaveLength(2); // the question that stayed the same is counted, not listed
    expect(screen.getByText(/recall 90% now, 95% with the new index/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows only the notice to someone who is not an editor (the comparison is a 404)", async () => {
    mockApi(teamRoutes({ "GET /v1/teams/registrar/kbs/k1/index-preview": () => Reply.error(404, "not_found", "Not found") }));
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByText("A platform admin is trying new index settings on this knowledge base", {}, { timeout: scaled(4000) })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("table", { name: /Questions that changed/ })).toBeNull());
    expect(screen.queryByText(/Couldn't/)).toBeNull();
  });

  it("says the new index is being built, with a meter, while it builds", async () => {
    mockApi(teamRoutes({ "GET /v1/teams/registrar/kbs/k1/profile-migration": () => building }));
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByText(/is being built\. Search and agents keep using Nomic 768/, {}, { timeout: scaled(4000) })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Documents embedded" })).toHaveAttribute("aria-valuetext", "12 of 40 documents");
  });
});

describe("The knowledge base's menu", () => {
  const kb: Schemas["KnowledgeBase"] = {
    id: "k1", name: "Student handbook", description: "", embeddingProfileId: "p1", topK: 8, sources: [{ id: "s1", name: "Policies", classification: "open", shared: false }],
    effectiveClassification: "open", revision: 2, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
  };
  const kbRoutes = (persona: "platform_admin" | "none") => ({
    ...shellRoutes(persona, "owner"),
    "GET /v1/teams/registrar/kbs/k1": () => kb,
    "GET /v1/teams/registrar/kbs/k1/profile-migration": () => null,
    "GET /v1/teams/registrar/sources": () => [],
    "GET /v1/shared-sources": () => [],
    "GET /v1/teams/registrar/agents": () => [],
  });

  it("offers Preview new settings… to platform admins, which opens the dialog for this knowledge base", async () => {
    mockApi({ ...routes(), ...kbRoutes("platform_admin") });
    renderApp("/teams/registrar/kbs/k1");
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }, { timeout: scaled(4000) }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Preview new settings…" }));
    const dialog = await screen.findByRole("dialog", { name: "Preview new settings" }, { timeout: scaled(4000) });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Knowledge base" })).toHaveValue("k1"));
  });

  it("does not offer it to a team owner who is not a platform admin", async () => {
    mockApi(kbRoutes("none"));
    renderApp("/teams/registrar/kbs/k1");
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }, { timeout: scaled(4000) }));
    // The menu is open once an item that must be there is; only then does an absent item mean something.
    expect(await screen.findByRole("menuitem", { name: "Delete knowledge base…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Preview new settings…" })).toBeNull();
  });
});
