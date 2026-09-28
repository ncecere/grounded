/* The source page redesign (W3, Q4, F-06, F-21): primary actions, the upload sheet, the document sheet and the documents facets. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { SourceDetail } from "../pages/sources/detail";
import { urlPath } from "../pages/team/documents/table";
import { withPendingTags } from "../pages/team/documents/upload";
import { common, mockApi, renderWith, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const uploadSource = (extra: Partial<Schemas["DataSource"]> = {}) => webSource({ type: "upload", web: null, name: "Policies", lastSyncAt: null, nextSyncAt: null, ...extra });

const doc = (id: string, extra: Partial<Schemas["Document"]> = {}): Schemas["Document"] => ({
  id,
  sourceId: "s1",
  title: "Scanned form",
  filename: "scan.pdf",
  url: "",
  kind: "pdf",
  sizeBytes: 600_000,
  version: 1,
  status: "ready",
  errorCode: "",
  errorMessage: "",
  errorDetail: "",
  pages: 2,
  chunkCount: 12,
  tokenCount: 2400,
  warnings: [],
  tags: ["forms"],
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  ...extra,
});

const routes = (source: Schemas["DataSource"], docs: Schemas["Document"][] = [doc("d1")]) => ({
  ...common,
  "GET /v1/teams/registrar/sources/s1": () => source,
  "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: docs, nextCursor: null }),
  "GET /v1/teams/registrar/sources/s1/tags": () => ["forms", "policy"],
  "GET /v1/teams/registrar/kbs": () => [],
});

describe("source page actions", () => {
  it("offers Upload files as the primary action and Pause and Delete in the menu", async () => {
    mockApi(routes(uploadSource()));
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByRole("button", { name: "Upload files" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Pause source", "Delete source…"]);
    await userEvent.keyboard("{Escape}");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a paused source offers Resume, not the upload sheet (F-21)", async () => {
    const calls = mockApi({
      ...routes(uploadSource({ status: "paused" })),
      "PATCH /v1/teams/registrar/sources/s1": () => uploadSource(),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const resume = await screen.findByRole("button", { name: "Resume" });
    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(screen.getByText(/It accepts no uploads/)).toBeInTheDocument();
    expect(screen.queryByText(/Activate/)).toBeNull();
    await userEvent.click(resume);
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "active" }));
  });
});

describe("uploads (F-06)", () => {
  it("applies tag text that wasn't committed with Enter", () => {
    expect(withPendingTags(["policy"], " Handbook, qa ")).toEqual(["policy", "handbook", "qa"]);
    expect(withPendingTags(["policy"], "policy")).toEqual(["policy"]);
    expect(withPendingTags([], "")).toEqual([]);
  });

  it("sends the pending tag with a drop", async () => {
    mockApi(routes(uploadSource()));
    const sent: FormData[] = [];
    class FakeXHR {
      upload = { onprogress: null };
      status = 200;
      responseText = JSON.stringify({ data: [{ filename: "a.pdf", status: "created" }] });
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send(body: FormData) {
        sent.push(body);
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("button", { name: "Upload files" }));
    const sheet = await screen.findByRole("dialog", { name: "Upload files" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Tags for these files/ }), "Handbook");
    const input = sheet.querySelector<HTMLInputElement>('input[type="file"]')!;
    // fireEvent-style upload: focus stays in the tag input, like a drag-and-drop from the desktop.
    await userEvent.upload(input, new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.getAll("tags")).toEqual(["handbook"]);
  });
});

describe("documents table and sheet (Q4, W3)", () => {
  it("filters on the server by status, with one-line titles and Kind · Size", async () => {
    expect(urlPath("https://registrar.example.edu/assets/fees.pdf?v=2")).toBe("/assets/fees.pdf?v=2");
    const calls = mockApi(routes(uploadSource()));
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    const title = await screen.findByRole("button", { name: "Scanned form" });
    expect(title).toHaveAttribute("title", "Scanned form");
    expect(screen.getByText("PDF · 586 KB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/documents") && new URLSearchParams(c.search).get("status") === "failed")).toBe(true));
  });

  const failed = doc("d2", {
    status: "skipped",
    errorCode: "needs_ocr",
    errorMessage: "This PDF has no text to read (it may be a scan).",
    errorDetail: "pdf: no text layer on page 1",
    chunkCount: 0,
  });

  it("opens a document's sheet with its facts and passage previews", async () => {
    mockApi({
      ...routes(uploadSource()),
      "GET /v1/teams/registrar/sources/s1/documents/d1": () => doc("d1"),
      "GET /v1/teams/registrar/sources/s1/documents/d1/passages": () => ({
        items: [{ ordinal: 0, content: "Refunds are issued within 30 days.", headingPath: ["Fees", "Refunds"], pageStart: 1, pageEnd: 1, tokenCount: 8 }],
        total: 12,
      }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Scanned form" }));
    const sheet = await screen.findByRole("region", { name: "Scanned form" });
    expect(sheet).toHaveTextContent("PDF · 586 KB");
    const previews = await within(sheet).findByRole("list", { name: "Passage previews" });
    expect(previews).toHaveTextContent("Fees › Refunds · p. 1");
    expect(previews).toHaveTextContent("Refunds are issued within 30 days.");
    expect(within(sheet).getByText("Showing 1 of 12 passages.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Show more passages" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a failed document's friendly error, with the parser's text on demand, and retries it", async () => {
    const calls = mockApi({
      ...routes(uploadSource(), [failed]),
      "GET /v1/teams/registrar/sources/s1/documents/d2": () => failed,
      "POST /v1/teams/registrar/sources/s1/documents/d2/retry": () => ({ ...failed, status: "pending" }),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Scanned form" }));
    const sheet = await screen.findByRole("region", { name: "Scanned form" });
    expect(await within(sheet).findByText("This PDF has no text to read (it may be a scan).")).toBeInTheDocument();
    expect(within(sheet).queryByText("pdf: no text layer on page 1")).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: /Technical details/ }));
    expect(within(sheet).getByText("pdf: no text layer on page 1")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/d2/retry"))).toBe(true));
  });

  it("re-fetches a web page from its sheet, and shows passages as plain text (W3)", async () => {
    const page = doc("d3", { title: "Fees", filename: "", url: "https://registrar.example.edu/fees", kind: "html", pages: 0 });
    const calls = mockApi({
      ...routes(webSource(), [page]),
      "GET /v1/teams/registrar/sources/s1/documents/d3": () => page,
      "GET /v1/teams/registrar/sources/s1/crawls": () => [],
      "GET /v1/teams/registrar/sources/s1/documents/d3/passages": () => ({
        items: [{ ordinal: 0, content: "The **2019** fee is in [the fee schedule](https://registrar.example.edu/f).", headingPath: [], pageStart: 0, pageEnd: 0, tokenCount: 8 }],
        total: 1,
      }),
      "POST /v1/teams/registrar/sources/s1/documents/d3/refetch": () => ({ id: "c9", sourceId: "s1", status: "queued", trigger: "page" }),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Pages/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Fees" }));
    const sheet = await screen.findByRole("region", { name: "Fees" });
    expect(await within(sheet).findByText("The 2019 fee is in the fee schedule.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Re-fetch page" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/d3/refetch"))).toBe(true));
    expect(await screen.findByText("Re-fetching the page")).toBeInTheDocument();
  });
});
