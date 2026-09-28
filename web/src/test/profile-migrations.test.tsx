/* Profile migrations (docs/phase5-deploy.md §5 P2): the admin page, its preflight and sheet, and the knowledge base's notice. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { durationText, graceText, percent } from "../pages/admin/profile-migrations/common";
import { mockApi, Reply, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

type Migration = Schemas["ProfileMigration"];
const estimate: Schemas["ProfileMigrationEstimate"] = { documents: 40, passages: 320, tokens: 51200, embeddingCalls: 5, requestsPerMinute: 110, minutes: 0.05, rechunk: true };
const base: Migration = {
  id: "m1",
  status: "running",
  kb: { id: "k1", name: "Student handbook" },
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  fromProfile: { id: "p1", name: "Nomic 768" },
  toProfile: { id: "p2", name: "Qwen3 768" },
  graceDays: 7,
  estimate,
  startedAt: "2026-09-27T09:00:00Z",
  startedBy: { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" },
  switchedAt: null,
  oldVectorsUntil: null,
  finishedAt: null,
  canSwitchBack: false,
  progress: { sources: 2, sourcesComplete: 1, documents: 40, done: 12, failed: 1, waiting: 0 },
  revision: 3,
};
const running: Migration = {
  ...base,
  sources: [
    { id: "s1", name: "Policies", shared: false, state: "complete", documents: 10, done: 10, failed: 0, waiting: 0, error: "" },
    { id: "s2", name: "Registrar pages", shared: true, state: "attention", documents: 30, done: 2, failed: 1, waiting: 0, error: "" },
  ],
  failures: [
    { documentId: "d1", sourceId: "s2", sourceName: "Registrar pages", title: "Tuition schedule", code: "model_error", message: "The embedding request failed: input too long", attempts: 1, failedAt: "2026-09-27T09:05:00Z" },
  ],
};
const switched: Migration = {
  ...base,
  id: "m2",
  status: "switched",
  kb: { id: "k2", name: "Advising" },
  switchedAt: "2026-09-26T09:00:00Z",
  oldVectorsUntil: "2099-10-03T09:00:00Z",
  canSwitchBack: true,
  progress: { sources: 0, sourcesComplete: 0, documents: 0, done: 0, failed: 0, waiting: 0 },
  revision: 5,
};
const profile = (id: string, name: string) => ({
  id,
  key: id,
  name,
  description: "",
  model: { id: "m-" + id, displayName: name + " model", maxClassification: "restricted" },
  dimensions: 768,
  storageType: "halfvec",
  documentPrefix: "",
  queryPrefix: "",
  chunkSize: 512,
  chunkOverlap: 0,
  chunkerVersion: 1,
  status: "active",
  isDefault: id === "p1",
  revision: 1,
  createdAt: "",
  updatedAt: "",
});
const kbs: Schemas["AdminKnowledgeBase"][] = [
  { id: "k1", name: "Student handbook", teamSlug: "registrar", teamName: "Office of the Registrar", profile: { id: "p1", name: "Nomic 768" }, sources: 2, passages: 320, migration: null },
];
const preflight = (blockers: Schemas["ProfileMigrationIssue"][] = []): Schemas["ProfileMigrationPreflight"] => ({
  kb: { id: "k1", name: "Student handbook", teamSlug: "registrar", teamName: "Office of the Registrar", profile: { id: "p1", name: "Nomic 768" } },
  target: { id: "p2", name: "Qwen3 768", model: "Qwen3 Embedding 4B", dimensions: 768, storageType: "halfvec", chunkSize: 512, chunkOverlap: 64, maxClassification: "restricted" },
  sources: [
    { id: "s1", name: "Policies", shared: false, otherKnowledgeBases: 0, documents: 10, passages: 80, tokens: 12800, inProgress: 0, failed: 0, alreadyEmbedded: false },
    { id: "s2", name: "Registrar pages", shared: true, otherKnowledgeBases: 1, documents: 30, passages: 240, tokens: 38400, inProgress: 2, failed: 0, alreadyEmbedded: false },
  ],
  estimate: { ...estimate, minutes: 45 },
  blockers,
  warnings: [{ code: "shared_sources", message: "1 source is also used by other knowledge bases." }],
  maintenance: false,
  defaultGraceDays: 7,
});

const routes = (extra: Record<string, (b: unknown) => unknown> = {}) => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/profile-migrations": () => [running, switched],
  "GET /v1/admin/profile-migrations/m1": () => running,
  "GET /v1/admin/profile-migrations/m2": () => switched,
  "GET /v1/admin/knowledge-bases": () => kbs,
  "GET /v1/admin/embedding-profiles": () => [profile("p1", "Nomic 768"), profile("p2", "Qwen3 768")],
  ...extra,
});

describe("Admin → Profile migrations", () => {
  it("lists migrations with a meter, opens one with per-source progress and failures, and retries with If-Match", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/m1/retry": () => ({ ...running, progress: { ...running.progress, failed: 0 }, failures: [], revision: 4 }) }));
    const { container } = renderApp("/admin/profile-migrations");
    const table = await screen.findByRole("table", { name: "Profile migrations" }, { timeout: 4000 });
    expect(await within(table).findByRole("meter", { name: "Progress of Student handbook" })).toHaveAttribute("aria-valuetext", "12 of 40 documents");
    expect(within(table).getByText(/Old vectors are kept for \d+ more days/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByText("Student handbook"));
    const sheet = await screen.findByRole("region", { name: "Student handbook: Nomic 768 → Qwen3 768" });
    expect(within(sheet).getByRole("meter", { name: /Registrar pages/ })).toHaveAttribute("aria-valuetext", "2 of 30 documents");
    expect(within(sheet).getByText("Tuition schedule")).toBeInTheDocument();
    expect(within(sheet).getByText(/input too long/)).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry failed documents" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/admin/profile-migrations/m1/retry")).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/retry"))!.headers.get("If-Match")).toBe('"3"');
  });

  it("switches back after a confirmation", async () => {
    const calls = mockApi(routes({ "POST /v1/admin/profile-migrations/m2/switch-back": () => ({ ...switched, status: "switched_back", canSwitchBack: false, revision: 6 }) }));
    renderApp("/admin/profile-migrations?record=m2");
    const sheet = await screen.findByRole("region", { name: "Advising: Nomic 768 → Qwen3 768" }, { timeout: 4000 });
    expect(within(sheet).getByRole("button", { name: "Delete old vectors now" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Switch back" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Switch Advising back to Nomic 768?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Switch back" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/switch-back"))?.headers.get("If-Match")).toBe('"5"'));
  });

  it("starts a migration from the preflight; blockers keep Start disabled", async () => {
    let blockers: Schemas["ProfileMigrationIssue"][] = [{ code: "model_classification", message: "The knowledge base holds data above Sensitive." }];
    const calls = mockApi(
      routes({
        "POST /v1/admin/profile-migrations/preflight": () => preflight(blockers),
        "POST /v1/admin/profile-migrations": () => ({ ...running, id: "m3" }),
        "GET /v1/admin/profile-migrations/m3": () => ({ ...running, id: "m3" }),
      }),
    );
    const { container } = renderApp("/admin/profile-migrations?start=k1");
    const dialog = await screen.findByRole("dialog", { name: "Migrate a knowledge base" }, { timeout: 4000 });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Knowledge base" })).toHaveValue("k1"));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Target profile" }), "p2");
    expect(await within(dialog).findByText("The knowledge base holds data above Sensitive.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Start migration" })).toBeDisabled();

    blockers = [];
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Target profile" }), "");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Target profile" }), "p2");
    expect(await within(dialog).findByText("about 45 minutes at 110 requests per minute")).toBeInTheDocument();
    expect(within(dialog).getByRole("table", { name: "Sources in Student handbook" })).toBeInTheDocument();
    expect(within(dialog).getByText("1 source is also used by other knowledge bases.")).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    const startButton = within(dialog).getByRole("button", { name: "Start migration" });
    await waitFor(() => expect(startButton).toBeEnabled());
    await userEvent.click(startButton);
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/v1/admin/profile-migrations")?.body).toEqual({ kbId: "k1", targetProfileId: "p2", graceDays: 7 }));
    expect(await screen.findByRole("region", { name: "Student handbook: Nomic 768 → Qwen3 768" })).toBeInTheDocument();
  });

  it("is read-only for auditors", async () => {
    mockApi({ ...routes(), ...shellRoutes("platform_auditor"), "GET /v1/admin/profile-migrations/m1": () => running, "GET /v1/admin/profile-migrations": () => [running] });
    renderApp("/admin/profile-migrations?record=m1");
    const sheet = await screen.findByRole("region", { name: /Student handbook/ }, { timeout: 4000 });
    expect(within(sheet).queryByRole("button", { name: "Cancel migration" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Migrate a knowledge base" })).toBeNull();
  });
});

describe("the knowledge base's migration", () => {
  const kb: Schemas["KnowledgeBase"] = {
    id: "k1",
    name: "Student handbook",
    description: "",
    embeddingProfileId: "p1",
    topK: 8,
    sources: [{ id: "s1", name: "Policies", classification: "open", shared: false }],
    effectiveClassification: "open",
    revision: 2,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
  };
  it("shows team members the progress with a meter", async () => {
    mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/teams/registrar/kbs/k1": () => kb,
      "GET /v1/teams/registrar/kbs/k1/profile-migration": () => running,
      "GET /v1/teams/registrar/sources": () => [],
      "GET /v1/shared-sources": () => [],
      "GET /v1/teams/registrar/agents": () => [],
    });
    const { container } = renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByText("Moving to the embedding profile Qwen3 768", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Documents re-embedded" })).toHaveAttribute("aria-valuetext", "12 of 40 documents");
    expect(screen.queryByRole("button", { name: "Manage migration" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows nothing without a migration", async () => {
    mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/teams/registrar/kbs/k1": () => kb,
      "GET /v1/teams/registrar/kbs/k1/profile-migration": () => null,
      "GET /v1/teams/registrar/sources": () => new Reply(200, { data: [] }),
    });
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByRole("heading", { level: 1, name: "Student handbook" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Moving to the embedding profile/)).toBeNull();
  });
});

describe("migration helpers", () => {
  it("formats durations, percentages and the grace period", () => {
    expect(durationText(null)).toBeNull();
    expect(durationText(0.2)).toBe("under a minute");
    expect(durationText(45)).toBe("about 45 minutes");
    expect(durationText(150)).toBe("about 2.5 hours");
    expect(durationText(60 * 24 * 5)).toBe("about 5 days");
    expect(percent(0, 0)).toBe(100);
    expect(percent(399, 400)).toBe(99);
    expect(percent(400, 400)).toBe(100);
    const now = Date.parse("2026-09-27T00:00:00Z");
    expect(graceText({ status: "switched", oldVectorsUntil: "2026-10-01T00:00:00Z" }, now)).toBe("Old vectors are kept for 4 more days.");
    expect(graceText({ status: "switched", oldVectorsUntil: "2026-09-26T00:00:00Z" }, now)).toBe("The old vectors are being deleted.");
    expect(graceText({ status: "completed", oldVectorsUntil: null }, now)).toBeNull();
  });
});
