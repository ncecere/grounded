/* Personal data scanning (docs/pii-scanning.md): Admin → Personal data, a document's findings and its review, and the
 * team overview's Needs attention row. A finding is a kind, a count and pages: no matched text reaches the page. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { findingText, patternProblems, piiChanges, piiForm, piiInput } from "../lib/pii";
import { SourceDetail } from "../pages/sources/detail";
import { mockApi as mockShell, renderApp, shellRoutes } from "./harness";
import { common, mockApi, renderWith, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const settings = (extra: Partial<Schemas["PiiSettings"]> = {}): Schemas["PiiSettings"] => ({
  enabled: true,
  blockLevels: [],
  patterns: [],
  revision: 1,
  updatedAt: "2026-11-01T10:00:00Z",
  review: [{ team: "registrar", teamName: "Registrar", held: 2, flagged: 5 }],
  ...extra,
});

describe("the personal data form", () => {
  it("says what was found in words, and checks pattern rows before saving", () => {
    expect(findingText({ kind: "us_ssn", count: 3, pages: [2, 4, 7] })).toBe("3 possible US Social Security numbers on pages 2, 4 and 7");
    expect(findingText({ kind: "payment_card", count: 1, pages: [] })).toBe("1 possible payment card number");
    expect(findingText({ kind: "Student ID", count: 2, pages: [1] })).toBe("2 matches of “Student ID” on page 1");
    const f = { enabled: true, blockLevels: [], patterns: [{ name: "", pattern: "x" }, { name: "us_ssn", pattern: "x" }, { name: "ID", pattern: "" }, { name: "id", pattern: "y" }] };
    expect(patternProblems(f)).toEqual({
      0: { field: "name", message: "Give the pattern a name." },
      1: { field: "name", message: "Use a name no other pattern has." },
      2: { field: "pattern", message: "Enter a regular expression." },
      3: { field: "name", message: "Use a name no other pattern has." },
    });
    const saved = settings({ blockLevels: ["restricted", "sensitive"] });
    expect(piiChanges(saved, { ...piiForm(saved), blockLevels: ["sensitive", "restricted"] })).toBe(0);
    expect(piiInput({ enabled: false, blockLevels: ["open"], patterns: [{ name: " Student ID ", pattern: "\\bU\\d{8}\\b" }] })).toEqual({
      enabled: false, blockLevels: ["open"], patterns: [{ name: "Student ID", pattern: "\\bU\\d{8}\\b" }],
    });
  });
});

describe("Admin → Personal data", () => {
  it("holds Restricted documents, adds a pattern, and saves with the revision", async () => {
    let saved = settings();
    const calls = mockShell({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/pii": () => saved,
      "PUT /v1/admin/pii": (body) => (saved = { ...settings(), ...(body as Schemas["PiiSettingsInput"]), revision: 2 }),
    });
    const { container } = renderApp("/admin/personal-data");
    expect(await screen.findByRole("switch", { name: /Look for possible personal data/ })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    // The teams waiting for a review are on their own tab, with the count in its name.
    await userEvent.click(screen.getByRole("tab", { name: "Waiting for review (7)" }));
    const review = await screen.findByRole("table", { name: /waiting for a personal data review/ });
    expect(within(review).getByRole("link", { name: "Registrar" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));

    await userEvent.click(await screen.findByRole("checkbox", { name: /Restricted/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add pattern" }));
    // An empty row is refused before saving, on its field.
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Give the pattern a name.")).toBeInTheDocument();
    const row = screen.getByRole("group", { name: "Pattern 1" });
    await userEvent.type(within(row).getByRole("textbox", { name: "Name" }), "Student ID");
    await userEvent.type(within(row).getByRole("textbox", { name: "Regular expression" }), "\\bU\\d{{8}\\b");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({ enabled: true, blockLevels: ["restricted"], patterns: [{ name: "Student ID", pattern: "\\bU\\d{8}\\b" }] });
    expect(await screen.findByText("Personal data settings saved")).toBeInTheDocument();
  });

  it("is read-only for auditors", async () => {
    mockShell({ ...shellRoutes("platform_auditor"), "GET /v1/admin/pii": () => settings({ patterns: [{ name: "Student ID", pattern: "\\bU\\d{8}\\b" }] }) });
    const { container } = renderApp("/admin/personal-data");
    expect(await screen.findByRole("switch", { name: /Look for possible personal data/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add pattern" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

const uploadSource = (extra: Partial<Schemas["DataSource"]> = {}) => webSource({ type: "upload", web: null, name: "Records", lastSyncAt: null, nextSyncAt: null, ...extra });

const doc = (id: string, extra: Partial<Schemas["Document"]> = {}): Schemas["Document"] => ({
  id, sourceId: "s1", title: "Roster", filename: "roster.pdf", url: "", kind: "pdf", sizeBytes: 90_000, version: 1, status: "ready",
  errorCode: "", errorMessage: "", errorDetail: "", pages: 4, chunkCount: 8, tokenCount: 2000, warnings: [], tags: [],
  createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", ...extra,
});

const routes = (docs: Schemas["Document"][]) => ({
  ...common,
  "GET /v1/teams/registrar/sources/s1": () => uploadSource({ documents: { ...uploadSource().documents, piiReview: docs.length } }),
  "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: docs, nextCursor: null }),
  "GET /v1/teams/registrar/sources/s1/tags": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/sources/s1/documents/d1/passages": () => ({ items: [], total: 8 }),
  "GET /v1/teams/registrar/sources/s1/documents/d2/passages": () => ({ items: [], total: 0 }),
});

describe("reviewing a document", () => {
  const flagged = doc("d1", {
    pii: { state: "flagged", findings: [{ kind: "us_ssn", count: 2, pages: [2, 3] }], reviewedAt: null },
    warnings: ["May contain personal data: 2 possible US Social Security numbers on pages 2 and 3. Review it, then dismiss the flag or remove the document."],
  });
  const held = doc("d2", {
    title: "Card office", status: "skipped", errorCode: "pii_review", chunkCount: 0,
    errorMessage: "Held for review before indexing: it may contain personal data (2 matches of “Student ID”). An editor can approve it to index it, or remove it.",
    pii: { state: "held", findings: [{ kind: "Student ID", count: 2, pages: [] }], reviewedAt: null },
  });

  it("filters the documents waiting for review, and dismisses a flag from the document's page", async () => {
    const calls = mockApi({
      ...routes([flagged, held]),
      "GET /v1/teams/registrar/sources/s1/documents/d1": () => flagged,
      "POST /v1/teams/registrar/sources/s1/documents/d1/pii-review": () => ({ ...flagged, warnings: [], pii: { ...flagged.pii!, state: "dismissed", reviewedAt: "2026-11-05T10:00:00Z" } }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    const table = await screen.findByRole("table", { name: "Documents" });
    expect(within(table).getAllByText("Needs review")).toHaveLength(2);
    // A held document is approved, not retried.
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Card office" }));
    expect(await screen.findByRole("menuitem", { name: "Review personal data" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Retry" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Needs review" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/documents") && new URLSearchParams(c.search).get("review") === "pii")).toBe(true));
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("button", { name: /^Roster/ }));
    const page = await screen.findByRole("region", { name: "Roster" });
    expect(within(page).getByText("2 possible US Social Security numbers on pages 2 and 3")).toBeInTheDocument();
    expect(within(page).getByText(/never stored or shown/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(page).getByRole("button", { name: "Dismiss flag" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "dismiss" }));
    expect(await screen.findByText("The personal data flag was dismissed")).toBeInTheDocument();
  });

  it("approves a held document for indexing", async () => {
    const calls = mockApi({
      ...routes([held]),
      "GET /v1/teams/registrar/sources/s1/documents/d2": () => held,
      "POST /v1/teams/registrar/sources/s1/documents/d2/pii-review": () => ({ ...held, status: "pending", errorCode: "", errorMessage: "", pii: { ...held.pii!, state: "approved", reviewedAt: "2026-11-05T10:00:00Z" } }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Card office/ }));
    const page = await screen.findByRole("region", { name: "Card office" });
    expect(within(page).getByText(/It is not indexed, so it can't appear in answers/)).toBeInTheDocument();
    expect(within(page).queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(page).getByRole("button", { name: "Approve and index" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "approve" }));
    expect(await screen.findByText("Card office was approved and queued for indexing")).toBeInTheDocument();
  });

  it("is shown, not reviewable, to members", async () => {
    mockApi({ ...routes([flagged]), "GET /v1/teams/registrar/sources/s1/documents/d1": () => flagged });
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Roster/ }));
    const page = await screen.findByRole("region", { name: "Roster" });
    expect(within(page).getByText("2 possible US Social Security numbers on pages 2 and 3")).toBeInTheDocument();
    expect(within(page).queryByRole("button", { name: "Dismiss flag" })).toBeNull();
  });
});
