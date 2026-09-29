/* Admin → Parsing & OCR: documents that failed or need OCR, by team and source (counts, no names), with Retry these and Notify owners; with axe. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { problemOcrBlock, retryDescription } from "../lib/document-problems";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const parsing: Schemas["ParsingSettings"] = {
  ocrEnabled: false, backend: "tesseract", visionModelId: null, languages: "eng", maxPagesPerDocument: 200, concurrency: 2, needsOcr: [],
  backends: [{ backend: "tesseract", configured: true, configuredBy: "OCR_TESSERACT_URL" }], revision: 1, updatedAt: null,
};

const group = (extra: Partial<Schemas["DocumentProblemGroup"]>): Schemas["DocumentProblemGroup"] => ({
  teamId: "t1", teamSlug: "registrar", teamName: "Registrar", sourceId: "s1", sourceName: "Scanned forms", reason: "needs_ocr", documents: 3,
  oldestAt: "2026-08-20T10:00:00Z", ocrState: "platform_off", ...extra,
});

const groups = [
  group({}),
  group({ reason: "damaged", documents: 1 }),
  group({ teamId: null, teamSlug: "", teamName: "", sourceId: "s2", sourceName: "Campus handbook", reason: "other", documents: 2 }),
];

const routes = (role: "platform_admin" | "platform_auditor", items = groups) => ({
  ...shellRoutes(role),
  "GET /v1/admin/models": () => [],
  "GET /v1/admin/parsing": () => parsing,
  "GET /v1/admin/parsing/document-problems": () => ({ items }),
  "POST /v1/admin/parsing/document-problems/retry": () => ({ retried: 1 }),
  "POST /v1/admin/parsing/document-problems/notify": () => ({ owners: 2, documents: 3 }),
});

describe("Admin → Parsing & OCR: documents that failed or need OCR", () => {
  it("lists counts by team, source and reason, and explains why scans can't be retried while OCR is off", async () => {
    mockApi(routes("platform_admin"));
    const { container } = renderApp("/admin/parsing");
    expect(await screen.findByRole("heading", { level: 1, name: "Parsing & OCR" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Documents that failed or need OCR \(6 documents\)/ });
    const scans = within(table).getByRole("row", { name: /Scanned forms.*Needs OCR/ });
    expect(scans).toHaveTextContent("Registrar");
    expect(scans).toHaveTextContent("OCR is off for the platform");
    expect(within(table).getByRole("row", { name: /Campus handbook/ })).toHaveTextContent("Shared sources");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Scanned forms: Needs OCR" }));
    const retry = await screen.findByRole("menuitem", { name: /Retry these/ });
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveTextContent("turn it on above first");
    expect(screen.getByRole("menuitem", { name: "Notify owners" })).toBeInTheDocument();
  });

  it("retries a group and notifies a team's owners after confirming", async () => {
    const calls = mockApi(routes("platform_admin"));
    const { container } = renderApp("/admin/parsing");
    const table = await screen.findByRole("table", { name: /Documents that failed or need OCR/ });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Scanned forms: Damaged or unsupported file" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Retry these" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Retry 1 document in Scanned forms?" });
    expect(confirm).toHaveTextContent(/usually fail again/);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(confirm).getByRole("button", { name: "Retry these" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/retry"))?.body).toEqual({ sourceId: "s1", reason: "damaged" }));

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Scanned forms: Needs OCR" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Notify owners" }));
    const notify = await screen.findByRole("alertdialog", { name: "Notify the owners of Registrar?" });
    expect(notify).toHaveTextContent(/It names no documents/);
    await userEvent.click(within(notify).getByRole("button", { name: "Notify owners" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/notify"))?.body).toEqual({ sourceId: "s1", reason: "needs_ocr" }));
    expect(await screen.findByText("Told 2 owners of Registrar")).toBeInTheDocument();
  });

  it("doesn't offer Notify owners for a shared source, nor any action to auditors", async () => {
    mockApi(routes("platform_auditor"));
    renderApp("/admin/parsing");
    const table = await screen.findByRole("table", { name: /Documents that failed or need OCR/ });
    expect(await within(table).findByRole("row", { name: /Campus handbook/ })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("says when nothing failed", async () => {
    mockApi(routes("platform_admin", []));
    renderApp("/admin/parsing");
    expect(await screen.findByText("No documents failed or need OCR.")).toBeInTheDocument();
  });

  it("blocks retrying scans and OCR errors only while OCR can't read the source", () => {
    expect(problemOcrBlock({ reason: "needs_ocr", ocrState: "on" })).toBeNull();
    expect(problemOcrBlock({ reason: "ocr_error", ocrState: "source_off" })).toMatch(/its team turned it off/);
    expect(problemOcrBlock({ reason: "damaged", ocrState: "platform_off" })).toBeNull();
    expect(retryDescription({ reason: "needs_ocr", ocrState: "on", documents: 2 })).toMatch(/^They go back in the queue and are read with OCR/);
  });
});
