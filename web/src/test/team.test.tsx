import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import type { TeamRole } from "../components/roles";
import { TeamContext, teamCtx, type Team } from "../pages/team/common";
import { UploadArea } from "../pages/team/documents/upload";
import { documentError } from "../pages/team/documents/status";
import { KBDetail } from "../pages/team/kbs/detail";
import { ApiKeysPage } from "../pages/team/keys/page";
import { allowedScopes } from "../pages/team/keys/scopes";
import { RetrievePlayground, pageRange } from "../pages/team/retrieve";
import { SourceDetail } from "../pages/team/sources";
import { boilerplate } from "./web-harness";

/* ---------- fixtures ---------- */

const team: Team = {
  id: "t1",
  slug: "registrar",
  name: "Office of the Registrar",
  description: "",
  maxClassification: "restricted",
  status: "active",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const me = {
  user: { id: "u1", email: "u1@example.edu", displayName: "Una User", platformRole: "none", status: "active" },
  teams: [],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: false, platformAuditor: false },
};

const level = (key: string, name: string, rank: number) => ({
  key,
  name,
  description: "",
  rank,
  maxAudience: "team",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
});
const levels = [level("restricted", "Restricted", 2), level("open", "Open", 0), level("sensitive", "Sensitive", 1)];

const profile = (id: string, name: string, isDefault: boolean) => ({
  id,
  key: id,
  name,
  description: "",
  dimensions: 768,
  chunkSize: 512,
  maxClassification: "restricted",
  isDefault,
});
const profiles = [profile("p1", "Nomic (default)", true), profile("p2", "Other model", false)];

const counts = { total: 3, pending: 0, processing: 0, ready: 2, failed: 1, skipped: 0, bytes: 2048, chunks: 40 };
const source = (id: string, name: string, embeddingProfileId = "p1", classification = "sensitive"): Schemas["DataSource"] => ({
  id,
  name,
  description: "",
  type: "upload",
  classification,
  embeddingProfileId,
  status: "active",
  documents: counts,
  revision: 3,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  web: null,
  lastSyncAt: null,
  nextSyncAt: null,
  activeCrawl: null,
  boilerplate: boilerplate({ enabled: false }),
});

const doc = (id: string, filename: string, status: Schemas["DocumentStatus"], extra: Partial<Schemas["Document"]> = {}): Schemas["Document"] => ({
  id,
  sourceId: "s1",
  title: "",
  filename,
  url: "",
  kind: "pdf",
  sizeBytes: 1024,
  version: 1,
  status,
  errorCode: "",
  errorMessage: "",
  errorDetail: "",
  pages: 4,
  chunkCount: 12,
  tokenCount: 3000,
  warnings: [],
  tags: [],
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  ...extra,
});

/* ---------- harness ---------- */

type Handler = (body: unknown) => unknown;
class ApiFailure {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
  ) {}
}

/** Replaces fetch with canned {"data": ...} responses keyed by "METHOD path". */
function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body?: unknown; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, url: url.pathname, body, headers: req.headers });
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    const out = handler(body);
    if (out instanceof ApiFailure) return json(out.status, { error: { code: out.code, message: out.message } });
    return json(200, { data: out });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());
// The router restores scroll position on navigation; jsdom doesn't implement it.
beforeAll(() => {
  window.scrollTo = () => {};
});

/** Renders a team page inside a router, the query client and the team context. */
/** Opens a page tab by its name (the pill tabs of the source and KB pages). */
const openTab = async (name: RegExp | string) => userEvent.click(await screen.findByRole("tab", { name }));

function renderTeam(ui: ReactNode, role: TeamRole = "editor") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me);
  const root = createRootRoute({
    component: () => <TeamContext.Provider value={teamCtx(team, role)}>{ui}</TeamContext.Provider>,
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

const common = {
  "GET /v1/me": () => me,
  "GET /v1/classifications": () => levels,
  "GET /v1/embedding-profiles": () => profiles,
};

/* ---------- uploads ---------- */

type UploadResponse = Schemas["UploadResult"][];

class FakeXHR {
  static instances: FakeXHR[] = [];
  static response: UploadResponse = [];
  headers: Record<string, string> = {};
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  body: FormData | null = null;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: FormData) {
    this.body = body;
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = 200;
      this.responseText = JSON.stringify({ data: FakeXHR.response });
      this.onload?.();
    }, 0);
  }
}

describe("uploading files", () => {
  it("sends the files with the CSRF token and reports created and rejected results", async () => {
    mockApi(common);
    FakeXHR.instances = [];
    FakeXHR.response = [
      { filename: "handbook.pdf", status: "created", document: doc("d1", "handbook.pdf", "pending") },
      // A file the picker's `accept` allows can still be refused by the server (it checks the content).
      { filename: "notes.txt", status: "rejected", error: { code: "unsupported_type", message: "This file type isn't supported" } },
    ];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const { container } = renderTeam(<UploadArea sourceId="s1" />);

    const picker = await screen.findByRole("button", { name: "Choose files to upload" });
    expect(picker).toBeInTheDocument();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toContain(".pdf");
    await userEvent.upload(input, [new File(["%PDF-1.7"], "handbook.pdf", { type: "application/pdf" }), new File(["MZ"], "notes.txt", { type: "text/plain" })], {
      applyAccept: false,
    });

    const status = await screen.findByText("Upload finished for 2 files: 1 added, 1 rejected.");
    expect(status.closest('[role="status"]')).not.toBeNull();
    const results = screen.getByRole("list", { name: "Upload results" });
    const items = within(results).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("handbook.pdf");
    expect(items[0]).toHaveTextContent("Added");
    expect(items[1]).toHaveTextContent("Rejected");
    expect(items[1]).toHaveTextContent("This file type isn't supported");

    const xhr = FakeXHR.instances[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/v1/teams/registrar/sources/s1/documents");
    expect(xhr.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(xhr.body?.getAll("files")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("rejects file types outside the accepted list before uploading, and says why", async () => {
    mockApi(common);
    FakeXHR.instances = [];
    FakeXHR.response = [{ filename: "handbook.pdf", status: "created", document: doc("d1", "handbook.pdf", "pending") }];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const { container } = renderTeam(<UploadArea sourceId="s1" />);
    await screen.findByRole("button", { name: "Choose files to upload" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    // applyAccept: false mimics a drop, which ignores the input's accept attribute.
    await userEvent.upload(input, [new File(["%PDF-1.7"], "handbook.pdf", { type: "application/pdf" }), new File(["MZ"], "virus.exe")], {
      applyAccept: false,
    });

    expect(await screen.findByText("virus.exe isn't an accepted file type.")).toBeInTheDocument();
    await screen.findByText("Upload finished for 1 file: 1 added.");
    const sent = FakeXHR.instances[0]!.body?.getAll("files") as File[];
    expect(sent.map((f) => f.name)).toEqual(["handbook.pdf"]);
  });

  it("shows the API's message for people (P-06)", () => {
    expect(documentError({ errorCode: "needs_ocr", errorMessage: "This PDF has no text to read (it may be a scan)." })).toBe("This PDF has no text to read (it may be a scan).");
    expect(documentError({ errorCode: "parse_failed", errorMessage: "" })).toBe("parse_failed");
  });
});

/* ---------- source detail ---------- */

function sourceRoutes() {
  return {
    ...common,
    "GET /v1/teams/registrar/sources/s1": () => source("s1", "Policies"),
    "GET /v1/teams/registrar/sources/s1/documents": () => ({
      items: [
        doc("d1", "handbook.pdf", "ready"),
        doc("d2", "scan.pdf", "skipped", { errorCode: "needs_ocr", errorMessage: "This PDF has no text to read (it may be a scan). Scanned documents aren't supported yet.", errorDetail: "no text layer" }),
      ],
      nextCursor: null,
    }),
    "PATCH /v1/teams/registrar/sources/s1": (body: unknown) => ({ ...source("s1", "Policies"), ...(body as object), revision: 4 }),
  };
}

describe("source detail", () => {
  it("shows documents and has no accessibility violations", async () => {
    mockApi(sourceRoutes());
    const { container } = renderTeam(<SourceDetail sourceId="s1" />, "admin");
    expect(await screen.findByRole("heading", { level: 1, name: "Policies" })).toBeInTheDocument();
    // Overview: one Documents card with the status breakdown; uploads are the header's primary action (a sheet).
    const counts = screen.getByRole("region", { name: "Document counts" });
    expect(within(counts).getByText("2 ready")).toBeInTheDocument();
    expect(within(counts).getByText("1 failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose files to upload" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Upload files" }));
    const sheet = await screen.findByRole("dialog", { name: "Upload files" });
    expect(within(sheet).getByRole("button", { name: "Choose files to upload" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));

    await openTab(/^Documents/);
    expect(await screen.findByRole("button", { name: "handbook.pdf" })).toBeInTheDocument();
    expect(screen.getByText(/This PDF has no text to read/)).toBeInTheDocument();
    // Row actions are one "…" menu per row (Q4), with Retry for failed and skipped documents.
    await userEvent.click(screen.getByRole("button", { name: "Actions for scan.pdf" }));
    expect(await screen.findByRole("menuitem", { name: /Retry/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asks for a reason only when lowering the classification", async () => {
    const calls = mockApi(sourceRoutes());
    renderTeam(<SourceDetail sourceId="s1" />, "admin");
    await openTab("Settings");
    const select = await screen.findByRole("combobox", { name: "Classification" });
    const reasonLabel = "Reason for lowering the classification";
    expect(screen.queryByLabelText(reasonLabel)).toBeNull();

    await userEvent.selectOptions(select, "restricted");
    expect(screen.queryByLabelText(reasonLabel)).toBeNull();

    await userEvent.selectOptions(select, "open");
    const reason = screen.getByLabelText(reasonLabel);
    const save = screen.getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Not saved: fix the highlighted field")).toBeInTheDocument();
    await userEvent.type(reason, "Public web content only");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.headers.get("If-Match")).toBe('"3"');
    expect(patch.body).toEqual({ classification: "open", reason: "Public web content only" });
  });

  it("does not offer lower classifications to editors", async () => {
    mockApi(sourceRoutes());
    renderTeam(<SourceDetail sourceId="s1" />, "editor");
    await openTab("Settings");
    const select = await screen.findByRole("combobox", { name: "Classification" });
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(["sensitive", "restricted"]);
  });

  it("hides write actions for members", async () => {
    mockApi(sourceRoutes());
    renderTeam(<SourceDetail sourceId="s1" />, "member");
    expect(await screen.findByRole("heading", { level: 1, name: "Policies" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    await openTab(/^Documents/);
    expect(await screen.findByRole("button", { name: "handbook.pdf" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions for handbook.pdf" }));
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Select/ })).toBeNull();
  });
});

/* ---------- knowledge bases and retrieval ---------- */

const kb: Schemas["KnowledgeBase"] = {
  id: "k1",
  name: "Student handbook",
  description: "",
  embeddingProfileId: "p1",
  topK: 8,
  sources: [{ id: "s1", name: "Policies", classification: "sensitive", shared: false }],
  effectiveClassification: "sensitive",
  revision: 2,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const hit = (n: number, extra: Partial<Schemas["RetrieveHit"]>): Schemas["RetrieveHit"] => ({
  chunkId: "c" + n,
  documentId: "d" + n,
  sourceId: "s1",
  content: "",
  headingPath: [],
  title: "",
  filename: "",
  url: "",
  score: 0.03,
  ...extra,
});

describe("knowledge base page", () => {
  it("lists only sources with the same embedding profile and is accessible", async () => {
    mockApi({
      ...common,
      "GET /v1/teams/registrar/kbs/k1": () => kb,
      "GET /v1/teams/registrar/sources": () => [source("s1", "Policies"), source("s2", "Catalog"), source("s3", "Legacy files", "p2")],
    });
    const { container } = renderTeam(<KBDetail kbId="k1" />, "editor");
    expect(await screen.findByRole("heading", { level: 1, name: "Student handbook" })).toBeInTheDocument();
    // Overview first, with the stat cards only there (W4).
    expect(screen.getByRole("region", { name: "Knowledge base summary" })).toBeInTheDocument();
    await openTab("Try it");
    expect(await screen.findByRole("textbox", { name: "Question or search terms" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Knowledge base summary" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await openTab(/^Sources/);
    await userEvent.click(await screen.findByRole("button", { name: "Attach source" }));
    const dialog = await screen.findByRole("dialog", { name: /Attach a source/ });
    expect(await within(dialog).findByRole("radio", { name: /Catalog/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Legacy files/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByText("Uses Other model; this knowledge base uses Nomic (default).")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has Attach source as its primary action, and asks for a source on an empty Overview (C13)", async () => {
    const empty = { ...kb, sources: [], effectiveClassification: null };
    mockApi({ ...common, "GET /v1/teams/registrar/kbs/k1": () => empty, "GET /v1/teams/registrar/sources": () => [source("s1", "Policies")] });
    const { container } = renderTeam(<KBDetail kbId="k1" />, "editor");
    const header = (await screen.findByRole("heading", { level: 1, name: "Student handbook" })).closest("header, [class*=header]") as HTMLElement;
    expect(within(header).getByRole("button", { name: "Attach source" })).toBeInTheDocument();
    expect(screen.getByText("No data sources attached yet.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Attach source" });
    expect(buttons).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(buttons[1]!);
    expect(await screen.findByRole("dialog", { name: /Attach a source/ })).toBeInTheDocument();
  });

  it("offers no Attach source to members", async () => {
    mockApi({ ...common, "GET /v1/teams/registrar/kbs/k1": () => ({ ...kb, sources: [] }) });
    renderTeam(<KBDetail kbId="k1" />, "member");
    await screen.findByRole("heading", { level: 1, name: "Student handbook" });
    expect(screen.getByText("No data sources attached yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach source" })).toBeNull();
  });

  it("renders retrieval hits as plain-text citations with page ranges", async () => {
    const calls = mockApi({
      "POST /v1/teams/registrar/kbs/k1/retrieve": () => ({
        latencyMs: 42,
        hits: [
          hit(1, {
            title: "Refund policy",
            filename: "refunds.pdf",
            headingPath: ["Policies", "Refunds"],
            pageStart: 3,
            pageEnd: 4,
            content: "Line one\nLine two <b>not bold</b>",
            vectorRank: 1,
            lexicalRank: 2,
          }),
          hit(2, { filename: "fees.pdf", pageStart: 7, pageEnd: 7, content: "Fees", vectorRank: 3 }),
        ],
      }),
    });
    const { container } = renderTeam(<RetrievePlayground kbId="k1" defaultTopK={8} />, "member");
    await userEvent.type(await screen.findByRole("textbox", { name: "Question or search terms" }), "refund deadline");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("2 results in 42 ms")).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Search results" })).getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("heading", { name: "1. Refund policy" })).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent("pp. 3–4");
    expect(cards[0]).toHaveTextContent("Policies › Refunds");
    expect(cards[0]).toHaveTextContent("vector #1 · keyword #2");
    const excerpt = within(cards[0]!).getByText(/Line one/);
    expect(excerpt.textContent).toBe("Line one\nLine two <b>not bold</b>");
    expect(cards[0]!.querySelector("b")).toBeNull();
    expect(cards[1]).toHaveTextContent("p. 7");
    expect(cards[1]).toHaveTextContent("vector #3");
    expect(cards[1]).not.toHaveTextContent("keyword #");
    expect(calls.at(-1)?.body).toEqual({ query: "refund deadline" });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains when the embedding model is unavailable", async () => {
    mockApi({
      "POST /v1/teams/registrar/kbs/k1/retrieve": () => new ApiFailure(503, "model_unavailable", "The embedding model is unavailable."),
    });
    renderTeam(<RetrievePlayground kbId="k1" defaultTopK={8} />, "member");
    await userEvent.type(await screen.findByRole("textbox", { name: "Question or search terms" }), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The embedding model is unavailable right now");
  });

  it("formats page ranges", () => {
    expect(pageRange(3, 3)).toBe("p. 3");
    expect(pageRange(3, null)).toBe("p. 3");
    expect(pageRange(3, 4)).toBe("pp. 3–4");
    expect(pageRange(null, null)).toBe("");
  });
});

/* ---------- API keys ---------- */

describe("API keys", () => {
  it("limits scopes by role", () => {
    expect(allowedScopes("member", "personal")).toEqual(["query"]);
    expect(allowedScopes("editor", "personal")).toEqual(["query", "ingest"]);
    expect(allowedScopes("admin", "personal")).toEqual(["query", "ingest", "manage"]);
    expect(allowedScopes("editor", "service")).toEqual([]);
    expect(allowedScopes("owner", "service")).toEqual(["query", "ingest", "manage"]);
  });

  it("shows the secret once, with a curl example, and never again", async () => {
    const created: Schemas["APIKey"] = {
      id: "key1",
      name: "Course search",
      kind: "personal",
      prefix: "rag_abc123",
      userId: "u1",
      scopes: ["query"],
      knowledgeBaseIds: null,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: "2026-09-25T10:00:00Z",
    };
    const secret = "rag_abc123_topsecretvalue";
    let list: Schemas["APIKey"][] = [];
    const calls = mockApi({
      ...common,
      "GET /v1/teams/registrar/kbs": () => [kb],
      "GET /v1/teams/registrar/api-keys": () => list,
      "POST /v1/teams/registrar/api-keys": () => {
        list = [created];
        return { key: created, secret };
      },
    });
    const { container } = renderTeam(<ApiKeysPage />, "member");
    expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "New API key" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    expect(within(dialog).queryByRole("combobox", { name: "Key type" })).toBeNull();
    expect(within(dialog).getAllByRole("checkbox", { name: /^(Query|Ingest|Manage):/ })).toHaveLength(1);
    await userEvent.type(within(dialog).getByLabelText("Name"), "Course search");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));

    const done = await screen.findByRole("dialog", { name: "API key created" });
    expect(within(done).getByText(secret)).toBeInTheDocument();
    expect(done).toHaveTextContent("It won't be shown again");
    expect(done).toHaveTextContent(`Authorization: Bearer ${secret}`);
    expect(done).toHaveTextContent("/v1/teams/registrar/kbs/k1/retrieve");
    expect(await axe(done)).toHaveNoViolations();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Course search", kind: "personal", scopes: ["query"] });

    await userEvent.click(within(done).getByRole("button", { name: "Done" }));
    const table = await screen.findByRole("table", { name: "API keys" });
    expect(await within(table).findByText("rag_abc123")).toBeInTheDocument();
    expect(within(table).getByText("Personal · query")).toBeInTheDocument();
    expect(container.ownerDocument.body).not.toHaveTextContent(secret);
    // Revoke is in the row menu, last (D5).
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Course search" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["View details", "Revoke…"]);
  });

  it("service keys: a responsible contact and an agent restriction, shown in the list (F-25)", async () => {
    const created: Schemas["APIKey"] = {
      id: "key2", name: "Site bot", kind: "service", prefix: "rag_svc", userId: "u2", scopes: ["query"], knowledgeBaseIds: null,
      agentIds: ["ag1"], contact: { userId: "u2", name: "Blair Member", email: "blair@example.edu" },
      expiresAt: null, lastUsedAt: null, createdAt: "2026-09-25T10:00:00Z",
    };
    let list: Schemas["APIKey"][] = [];
    const member = (id: string, name: string) => ({ user: { id, email: `${id}@example.edu`, displayName: name, status: "active" }, role: "member", revision: 1, createdAt: "2026-09-01T00:00:00Z" });
    const calls = mockApi({
      ...common,
      "GET /v1/teams/registrar/kbs": () => [kb],
      "GET /v1/teams/registrar/agents": () => [{ id: "ag1", name: "Registrar assistant" }, { id: "ag2", name: "Staff helper" }],
      "GET /v1/teams/registrar/members": () => [member(me.user.id, "Me"), member("u2", "Blair Member")],
      "GET /v1/teams/registrar/api-keys": () => list,
      "POST /v1/teams/registrar/api-keys": () => {
        list = [created];
        return { key: created, secret: "rag_svc_secret" };
      },
      "PATCH /v1/teams/registrar/api-keys/key2": () => created,
    });
    renderTeam(<ApiKeysPage />, "owner");
    await userEvent.click(await screen.findByRole("button", { name: "New API key" }));
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Site bot");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Key type" }), "service");
    await userEvent.selectOptions(await within(dialog).findByRole("combobox", { name: "Responsible contact" }), "u2");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Registrar assistant" }));
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
    await screen.findByRole("dialog", { name: "API key created" });
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ kind: "service", agentIds: ["ag1"], responsibleUserId: "u2" });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Contact: Blair Member")).toBeInTheDocument();
    expect(screen.getByText("Agents: Registrar assistant")).toBeInTheDocument();

    // The key's sheet: restrictions, contact (reassignable) and Revoke.
    await userEvent.click(screen.getByRole("button", { name: "Actions for Site bot" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const sheet = await screen.findByRole("region", { name: "Site bot" });
    expect(within(sheet).getByText("Team service key")).toBeInTheDocument();
    expect(within(sheet).getByText("Registrar assistant")).toBeInTheDocument();
    expect(within(sheet).getByText("Every knowledge base of the team")).toBeInTheDocument();
    expect(within(sheet).getByText("Query: search knowledge bases")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Revoke key" })).toBeInTheDocument();
    expect(await axe(sheet)).toHaveNoViolations();
    await userEvent.selectOptions(await within(sheet).findByRole("combobox", { name: "Contact" }), me.user.id);
    await userEvent.click(within(sheet).getByRole("button", { name: "Change contact" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ responsibleUserId: me.user.id }));
  });
});
