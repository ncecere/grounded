/* OCR for scanned documents (docs/ocr.md): Admin → Parsing, the source's OCR switch, the document's OCR note and the Needs OCR filter with its bulk retry. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ocrNote, pageRanges, parsingChanges, parsingForm, parsingInput, parsingProblems } from "../lib/parsing";
import { SourceDetail } from "../pages/sources/detail";
import { mockApi as mockShell, renderApp, shellRoutes } from "./harness";
import { common, mockApi, renderWith, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const settings = (extra: Partial<Schemas["ParsingSettings"]> = {}): Schemas["ParsingSettings"] => ({
  ocrEnabled: false,
  backend: "tesseract",
  visionModelId: null,
  languages: "eng",
  backends: [
    { backend: "tesseract", configured: true, configuredBy: "OCR_TESSERACT_URL" },
    { backend: "tika", configured: false, configuredBy: "TIKA_URL" },
    { backend: "vision", configured: true, configuredBy: "a vision model" },
  ],
  maxPagesPerDocument: 200,
  concurrency: 2,
  needsOcr: [{ teamId: "t1", teamSlug: "registrar", teamName: "Registrar", documents: 14 }],
  revision: 1,
  updatedAt: null,
  ...extra,
});

const visionModel = {
  id: "v1", connectionId: "c1", key: "vision", upstreamModel: "qwen-vl", displayName: "Qwen VL", description: "", kind: "vision",
  maxClassification: "open", enabled: true, supportsTools: false, supportsVision: false, compat: {}, moderationProvider: null, moderationFamily: null,
  revision: 1, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
};

describe("Admin → Parsing", () => {
  it("turns OCR on with Tesseract and two languages, tests it, and saves with the revision", async () => {
    let saved = settings();
    const calls = mockShell({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [visionModel],
      "GET /v1/admin/parsing": () => saved,
      "PUT /v1/admin/parsing": (body) => (saved = { ...settings(), ...(body as Schemas["ParsingSettingsInput"]), revision: 2, updatedAt: "2026-09-28T11:00:00Z" }),
      "POST /v1/admin/parsing/test": () => ({
        ok: true, backend: "tesseract", text: "Grounded OCR test page", expected: "Grounded OCR test page", confidence: 0.95, latencyMs: 180, tokensIn: 0, tokensOut: 0,
      }),
    });
    const { container } = renderApp("/admin/parsing");
    const toggle = await screen.findByRole("switch", { name: /Read scanned pages and images with OCR/ });
    expect(screen.getByRole("radio", { name: /Apache Tika/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Not configured: set TIKA_URL.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Documents that need OCR, by team \(14 documents\)/ })).toHaveTextContent("Registrar");
    expect(screen.getByText(/At most 200; pages beyond it are skipped/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(toggle);
    const langs = screen.getByRole("textbox", { name: "Languages" });
    await userEvent.clear(langs);
    await userEvent.type(langs, "eng+spa");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Tesseract read the page in 180 ms")).toBeInTheDocument();
    expect(screen.getByText(/Confidence 95%/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/v1/admin/parsing/test")?.body).toEqual({ backend: "tesseract", visionModelId: null, languages: "eng+spa" });
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({ ocrEnabled: true, backend: "tesseract", visionModelId: null, languages: "eng+spa" });
    expect(await screen.findByText("Parsing settings saved")).toBeInTheDocument();
  });

  it("asks for a vision model for the vision backend, and shows failures", async () => {
    const calls = mockShell({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [visionModel],
      "GET /v1/admin/parsing": () => settings({ needsOcr: [] }),
      "POST /v1/admin/parsing/test": () => ({
        ok: false, backend: "vision", text: "", expected: "x", confidence: 0, latencyMs: 30, tokensIn: 0, tokensOut: 0, error: "the proxy is unavailable",
      }),
    });
    const { container } = renderApp("/admin/parsing");
    expect(await screen.findByText("No documents need OCR.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /Read scanned pages/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Vision model/ }));
    expect(screen.queryByRole("textbox", { name: "Languages" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Choose a vision model to use the vision backend.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Vision model" }), "v1");
    expect(screen.getByText(/classified above the model's maximum \(open\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Vision model failed after 30 ms")).toBeInTheDocument();
    expect(screen.getByText("the proxy is unavailable")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is read-only for auditors", async () => {
    mockShell({ ...shellRoutes("platform_auditor"), "GET /v1/admin/models": () => [], "GET /v1/admin/parsing": () => settings() });
    renderApp("/admin/parsing");
    const toggle = await screen.findByRole("switch", { name: /Read scanned pages/ });
    expect(toggle.getAttribute("aria-disabled") === "true" || toggle.hasAttribute("data-disabled")).toBe(true);
    // Auditors can't run the Test (403), so it isn't offered; the page says OCR is off and who can turn it on.
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.getByText(/It is off until a platform admin turns it on\./)).toBeInTheDocument();
  });
});

describe("parsing helpers", () => {
  it("round-trips the form, validates it and counts changes", () => {
    const s = settings();
    const f = parsingForm(s);
    expect(parsingInput({ ...f, languages: " eng+spa " })).toEqual({ ocrEnabled: false, backend: "tesseract", visionModelId: null, languages: "eng+spa" });
    expect(parsingProblems({ ...f, languages: "eng spa" }, s).languages).toMatch(/joined with \+/);
    expect(parsingProblems({ ...f, ocrEnabled: true, backend: "tika" }, s).backend).toBe("Apache Tika isn't configured: set TIKA_URL.");
    expect(parsingProblems({ ...f, ocrEnabled: false, backend: "tika" }, s)).toEqual({});
    expect(parsingChanges(s, { ...f, ocrEnabled: true, languages: "deu" })).toBe(2);
  });

  it("says which pages were read with OCR", () => {
    expect(pageRanges([3, 4, 5, 6, 7, 9, 11, 12])).toBe("3–7, 9, 11–12");
    expect(ocrNote({ backend: "tesseract", pages: [3, 4, 5, 6, 7] }, 10)).toBe("Pages 3–7 were read with OCR (Tesseract).");
    expect(ocrNote({ backend: "vision", pages: [2] }, 4)).toBe("Page 2 was read with OCR (a vision model).");
    expect(ocrNote({ backend: "tika", pages: [1] }, 1)).toBe("It was read with OCR (Apache Tika).");
  });
});

const uploadSource = (extra: Partial<Schemas["DataSource"]> = {}) => webSource({ type: "upload", web: null, name: "Scans", lastSyncAt: null, nextSyncAt: null, ...extra });

const doc = (id: string, extra: Partial<Schemas["Document"]> = {}): Schemas["Document"] => ({
  id, sourceId: "s1", title: "Board minutes 1998", filename: "minutes.pdf", url: "", kind: "pdf", sizeBytes: 900_000, version: 1, status: "ready",
  errorCode: "", errorMessage: "", errorDetail: "", pages: 10, chunkCount: 8, tokenCount: 2000, warnings: [], tags: [],
  createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", ...extra,
});

const routes = (source: Schemas["DataSource"], docs: Schemas["Document"][]) => ({
  ...common,
  "GET /v1/teams/registrar/sources/s1": () => source,
  "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: docs, nextCursor: null }),
  "GET /v1/teams/registrar/sources/s1/tags": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
});

describe("OCR on a source", () => {
  it("turns OCR off in the source's settings", async () => {
    const calls = mockApi({
      ...routes(uploadSource(), []),
      "PATCH /v1/teams/registrar/sources/s1": (body) => uploadSource({ ...(body as object), revision: 6 }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /Settings/ }));
    const toggle = await screen.findByRole("switch", { name: /Read scanned pages with OCR/ });
    expect(toggle).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ ocrEnabled: false }));
  });

  it("notes the pages read with OCR on the document's page", async () => {
    const scanned = doc("d1", { ocr: { backend: "tesseract", pages: [3, 4, 5, 6, 7] } });
    mockApi({
      ...routes(uploadSource(), [scanned]),
      "GET /v1/teams/registrar/sources/s1/documents/d1": () => scanned,
      "GET /v1/teams/registrar/sources/s1/documents/d1/passages": () => ({ items: [], total: 8 }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Board minutes 1998" }));
    const page = await screen.findByRole("region", { name: "Board minutes 1998" });
    expect(within(page).getByText("Pages 3–7 were read with OCR (Tesseract).")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("filters the documents that need OCR and retries them all", async () => {
    const skipped = doc("d2", { status: "skipped", errorCode: "needs_ocr", errorMessage: "This PDF has no text to read (it may be a scan).", chunkCount: 0 });
    const waiting = doc("d3", { title: "Deed", status: "pending", errorCode: "ocr_daily_limit", errorMessage: "Waiting for the team's daily OCR page limit.", chunkCount: 0 });
    const calls = mockApi({
      ...routes(uploadSource(), [skipped, waiting]),
      "POST /v1/teams/registrar/sources/s1/documents/retry": () => ({ retried: 1 }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    expect(await screen.findByText("Waiting")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Needs OCR" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/documents") && new URLSearchParams(c.search).get("errorCode") === "needs_ocr" && !new URLSearchParams(c.search).get("status"))).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: "Retry all that need OCR" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/documents/retry"))?.body).toEqual({ errorCode: "needs_ocr" }));
    expect(await screen.findByText("1 document was queued again")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it("keeps the bulk retry until OCR is on for the source, and says why", async () => {
    const skipped = doc("d2", { status: "skipped", errorCode: "needs_ocr", errorMessage: "This PDF has no text to read (it may be a scan).", chunkCount: 0 });
    mockApi(routes(uploadSource({ ocrEnabled: false, ocrState: "source_off" }), [skipped]));
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Needs OCR" }));
    const retry = await screen.findByRole("button", { name: "Retry all that need OCR" });
    expect(retry).toBeDisabled();
    expect(retry).toHaveAccessibleDescription(/OCR is off for this source\. Turn it on in the Settings tab first/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("refuses images with OCR's reason when it is off, and offers the source's settings", async () => {
    mockApi(routes(uploadSource({ ocrEnabled: false, ocrState: "source_off" }), []));
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("button", { name: "Upload files" }));
    const dialog = await screen.findByRole("dialog", { name: "Upload files" });
    expect(within(dialog).getByText(/plain text\. Images need OCR, which is off for this source\./)).toBeInTheDocument();
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).not.toContain(".png");
    await userEvent.upload(input, new File(["x"], "notice.png", { type: "image/png" }), { applyAccept: false });
    expect(await within(dialog).findByText("notice.png wasn't uploaded")).toBeInTheDocument();
    expect(within(dialog).getByText(/Turn on OCR in the source's settings to upload images\./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Open settings" }));
    expect(await screen.findByRole("switch", { name: /Read scanned pages with OCR/ })).not.toBeChecked();
  });

  it("accepts images when OCR is on for the platform and the source", async () => {
    mockApi(routes(uploadSource({ ocrEnabled: true, ocrState: "on" }), []));
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("button", { name: "Upload files" }));
    const dialog = await screen.findByRole("dialog", { name: "Upload files" });
    expect(dialog.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toContain(".png,.jpg,.jpeg,.tif,.tiff");
    expect(within(dialog).getByText(/and PNG, JPEG or TIFF images \(read with OCR\)\./)).toBeInTheDocument();
  });
});
