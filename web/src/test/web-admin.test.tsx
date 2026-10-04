import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { CrawlingPage } from "../pages/admin/crawling/page";
import { PlatformSources } from "../pages/admin/shared";
import { SourceDetail } from "../pages/sources/detail";
import { KBDetail } from "../pages/team/kbs/detail";
import { ApiFailure, common, counts, mockApi, renderWith, request, webSource } from "./web-harness";

/* Admin crawling, shared sources and attaching sources to knowledge bases (fixtures in web-harness.tsx). */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("admin crawling page", () => {
  it("lists the allowlist and approves a domain request with a note", async () => {
    let requests = [request("r1", "pending"), request("r2", "approved", { pattern: "news.example.com", reviewedAt: "2026-09-21T10:00:00Z" })];
    const calls = mockApi({
      "GET /v1/admin/crawl-allowlist": () => [{ id: "a1", pattern: "*.example.edu", note: "University sites", createdBy: null, createdAt: "2026-09-01T10:00:00Z" }],
      "GET /v1/admin/domain-requests": () => requests,
      "POST /v1/admin/domain-requests/r1/review": (body) => {
        requests = [request("r1", "approved", { reviewNote: (body as { note: string }).note, reviewedAt: "2026-09-25T10:00:00Z" }), requests[1]!];
        return requests[0];
      },
    });
    const { container } = renderWith(<CrawlingPage />, { platformRole: "platform_admin" });
    // Requests come first (Q7), with the pending count on the tab; pending requests first in the list.
    expect(await screen.findByRole("tab", { name: /Requests/ })).toHaveAttribute("aria-selected", "true");
    const table = await screen.findByRole("table", { name: "Domain requests" });
    expect(await within(table).findAllByText("Blair Dev")).toHaveLength(2);
    expect(within(table).getAllByRole("rowheader").map((c) => c.textContent)).toEqual(["*.example.org", "news.example.com"]);
    expect(within(table).getByText("Pending review")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Approve from the row menu (Revoke is offered on the approved one).
    await userEvent.click(within(table).getByRole("button", { name: "Actions for news.example.com for Academic Advising" }));
    expect(await screen.findByRole("menuitem", { name: "Revoke…" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(table).getByRole("button", { name: "Actions for *.example.org for Academic Advising" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Approve…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Approve *.example.org?" });
    expect(dialog).toHaveTextContent("Academic Advising's web sources can crawl hosts matching *.example.org");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "Approved for transfer guides");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "approve", note: "Approved for transfer guides" });
    expect(await screen.findByText("*.example.org was approved")).toBeInTheDocument();
    await waitFor(() => expect(within(table).queryByText("Pending review")).toBeNull());

    // The request's page has the note.
    await userEvent.click(within(table).getByRole("button", { name: "Actions for *.example.org for Academic Advising" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const page = await screen.findByRole("region", { name: "*.example.org" });
    expect(within(page).getByText("Approved for transfer guides")).toBeInTheDocument();
    await userEvent.click(within(page).getByRole("link", { name: /^Back/ }));

    await userEvent.click(screen.getByRole("tab", { name: "Allowlist" }));
    const allowlist = await screen.findByRole("table", { name: "Crawl allowlist" });
    expect(within(allowlist).getByText("*.example.edu")).toBeInTheDocument();
    // A row menu like every other table's (VI-22).
    await userEvent.click(within(allowlist).getByRole("button", { name: "Actions for *.example.edu" }));
    expect(await screen.findByRole("menuitem", { name: "Remove…" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("searchbox", { name: "Search the allowlist" })).toBeInTheDocument();
  });

  it("confirms *, puts a refused address on the field (AD-08), and says which requests are already allowed (AD-26)", async () => {
    const calls = mockApi({
      "GET /v1/admin/crawl-allowlist": () => [{ id: "a1", pattern: "*.example.org", note: "", createdBy: null, createdAt: "2026-09-01T10:00:00Z" }],
      "GET /v1/admin/domain-requests": () => [request("r1", "pending", { pattern: "status.example.org" })],
      "POST /v1/admin/crawl-allowlist": (body) =>
        (body as { pattern: string }).pattern === "*"
          ? { id: "a2", pattern: "*", note: "", createdBy: null, createdAt: "2026-09-02T10:00:00Z" }
          : new ApiFailure(400, "blocked_address", "The crawler never fetches private, loopback, link-local or cloud metadata addresses, so this entry would do nothing."),
    });
    const { container } = renderWith(<CrawlingPage />, { platformRole: "platform_admin" });
    expect(await screen.findByText("status.example.org (Academic Advising) is covered by *.example.org on the allowlist.", { exact: false })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: "Allowlist" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add pattern" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an allowlist pattern" });
    const input = within(dialog).getByRole("textbox", { name: "Host pattern" });
    await userEvent.type(input, "169.254.169.254");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add pattern" }));
    expect(await within(dialog).findByText(/never fetches private, loopback, link-local or cloud metadata addresses/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await userEvent.clear(input);
    await userEvent.type(input, "*");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add pattern" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Allow every public host?" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await userEvent.click(within(confirm).getByRole("button", { name: "Allow every public host" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ pattern: "*" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add an allowlist pattern" })).toBeNull());
  });

  it("is read-only for auditors", async () => {
    mockApi({
      "GET /v1/admin/crawl-allowlist": () => [{ id: "a1", pattern: "*.example.edu", note: "", createdBy: null, createdAt: "2026-09-01T10:00:00Z" }],
      "GET /v1/admin/domain-requests": () => [request("r1", "pending")],
    });
    renderWith(<CrawlingPage />, { platformRole: "platform_auditor" });
    expect(await screen.findByText(/Auditors can view the allowlist/)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Domain requests/ });
    expect(screen.queryByRole("button", { name: /^(Approve|Deny|Remove|Add pattern)\b(?!d)/ })).toBeNull();
    await userEvent.click(within(table).getByRole("button", { name: /^Actions for/ }));
    expect(await screen.findByRole("menuitem", { name: "View details" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Approve|Deny/ })).toBeNull();
  });
});

/* ---------- shared sources ---------- */

describe("shared sources", () => {
  it("blocks raising the classification when team knowledge bases would be affected", async () => {
    const shared = { ...webSource({ id: "sh1", name: "Campus academic calendar" }), activeCrawl: null };
    const calls = mockApi({
      ...common,
      "GET /v1/admin/shared-sources/sh1": () => shared,
      "GET /v1/admin/shared-sources/sh1/documents": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/shared-sources/sh1/crawls": () => [],
      "PATCH /v1/admin/shared-sources/sh1": (_body, url) =>
        url.searchParams.get("preview") === "true"
          ? {
              classification: "restricted",
              affected: [
                {
                  teamId: "t2",
                  teamSlug: "advising",
                  teamName: "Academic Advising",
                  teamMaxClassification: "sensitive",
                  knowledgeBaseId: "k9",
                  knowledgeBaseName: "Advising FAQ",
                },
              ],
            }
          : shared,
    });
    renderWith(
      <PlatformSources>
        <SourceDetail sourceId="sh1" />
      </PlatformSources>,
      { platformRole: "platform_admin" },
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Campus academic calendar" })).toBeInTheDocument();
    expect(screen.getByText("Shared with every team")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Classification" }), "restricted");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Can't raise the classification to Restricted yet" });
    expect(within(dialog).getByRole("table", { name: "Affected knowledge bases" })).toHaveTextContent("Advising FAQ");
    expect(within(dialog).getByRole("link", { name: "Academic Advising" })).toHaveAttribute("href", "/admin/teams/advising");
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.search).toBe("?preview=true");
    expect(patches[0]!.body).toEqual({ classification: "restricted" });
  });
});

/* ---------- KB attach ---------- */

describe("attaching sources to a knowledge base", () => {
  it("offers team and shared sources, filtered by profile and classification", async () => {
    const teamSource = { ...webSource({ id: "s2", name: "Catalog", type: "upload", web: null }) };
    const catalog = (id: string, name: string, extra: Partial<Schemas["SharedSource"]> = {}): Schemas["SharedSource"] => ({
      id,
      name,
      description: "",
      type: "web",
      classification: "open",
      embeddingProfileId: "p1",
      status: "active",
      documents: counts,
      ...extra,
    });
    const calls = mockApi({
      ...common,
      "GET /v1/teams/registrar/kbs/k1": () => ({
        id: "k1",
        name: "Student help",
        description: "",
        embeddingProfileId: "p1",
        topK: 8,
        sources: [{ id: "sh0", name: "Campus directory", classification: "open", shared: true }],
        effectiveClassification: "open",
        revision: 1,
        createdAt: "2026-09-01T10:00:00Z",
        updatedAt: "2026-09-01T10:00:00Z",
      }),
      "GET /v1/teams/registrar/sources": () => [teamSource],
      "GET /v1/shared-sources": () => [
        catalog("sh0", "Campus directory"),
        catalog("sh1", "Campus academic calendar"),
        catalog("sh2", "Research data", { classification: "restricted" }),
        catalog("sh3", "Old model source", { embeddingProfileId: "p2" }),
      ],
      "PUT /v1/teams/registrar/kbs/k1/sources/sh1": () => ({}),
    });
    const { container } = renderWith(<KBDetail kbId="k1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Sources/ }));
    const attached = await screen.findByRole("table", { name: "Attached data sources" });
    expect(within(attached).getByText("Campus directory")).toBeInTheDocument();
    expect(within(attached).getByText("Shared")).toBeInTheDocument();
    expect(within(attached).queryByRole("link", { name: "Campus directory" })).toBeNull();

    // An explicit Attach source button; ineligible sources are listed, disabled, with their reason (W4).
    await userEvent.click(screen.getByRole("button", { name: "Attach source" }));
    const dialog = await screen.findByRole("dialog", { name: "Attach a source to Student help" });
    expect(await within(dialog).findAllByRole("radio")).toHaveLength(4);
    expect(within(dialog).getByRole("radio", { name: /Catalog/ })).toBeChecked();
    expect(within(dialog).getByText("Classified Restricted; your team is approved up to Sensitive.")).toBeInTheDocument();
    expect(within(dialog).getByText("Uses Other model; this knowledge base uses Nomic.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(dialog).getByRole("radio", { name: /Campus academic calendar/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Attach source" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/sources/sh1"))).toBe(true));
  });
});
