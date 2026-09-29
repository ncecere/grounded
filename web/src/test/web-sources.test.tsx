/* Phase 2: web source helpers, creating a web source and the web source detail page (fixtures in web-harness.tsx; admin pages in web-admin.test.tsx). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { CreateSourcePage, useCreateSource } from "../pages/sources/create";
import { crawlAnnouncement, formatDuration } from "../pages/sources/crawls";
import { SourceDetail } from "../pages/sources/detail";
import { hostFromError } from "../pages/sources/host-errors";
import { validateWeb, webDefaults, webInput } from "../pages/sources/web-form";
import { ApiError } from "../api/client";
import { validateHostPattern } from "../pages/team/domains";
import { ApiFailure, common, counts, crawl, mockApi, renderWith, team, webRoutes, webSource } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());

beforeAll(() => {
  window.scrollTo = () => {};
});

/* ---------- helpers ---------- */

/** The sources list's "New data source" button and what it opens. */
function NewSource() {
  const create = useCreateSource();
  return (
    <>
      <button type="button" onClick={create.start}>
        New data source
      </button>
      {create.element}
    </>
  );
}

describe("web source helpers", () => {
  it("validates URLs, counts and crawl limits", () => {
    expect(validateWeb({ ...webDefaults, urls: "" }).urls).toBe("Enter at least one start URL.");
    expect(validateWeb({ ...webDefaults, urls: "registrar.example.edu" })).toEqual({});
    expect(validateWeb({ ...webDefaults, urls: "ftp://x.org/" }).urls).toMatch(/Not a valid web address/);
    expect(validateWeb({ ...webDefaults, urls: "https://a.org/", maxDepth: "11", maxPages: "0" })).toEqual({
      maxDepth: "Enter a whole number from 0 to 10.",
      maxPages: "Enter a whole number of at least 1.",
    });
    const many = Array.from({ length: 21 }, (_, i) => `https://a.org/${i}`).join("\n");
    expect(validateWeb({ ...webDefaults, urls: many }).urls).toMatch(/at most 20 URLs/);
    expect(validateWeb({ ...webDefaults, mode: "batch", urls: many })).toEqual({});
  });

  it("builds the API body for each mode", () => {
    expect(webInput({ ...webDefaults, mode: "scrape", urls: "registrar.example.edu/refunds/" })).toEqual({
      mode: "scrape",
      urls: ["https://registrar.example.edu/refunds/"],
      schedule: "weekly",
      tags: [],
    });
    expect(webInput({ ...webDefaults, urls: "https://a.org/", includePrefixes: "/news/\n\n/about/ ", exclude: "/calendar/**" })).toEqual({
      mode: "crawl",
      urls: ["https://a.org/"],
      maxDepth: 2,
      maxPages: 200,
      includePrefixes: ["/news/", "/about/"],
      exclude: ["/calendar/**"],
      allowSubdomains: false,
      useSitemaps: true,
      schedule: "weekly",
      tags: [],
    });
    // Tags are always sent, so saving a source never clears them.
    expect(webInput({ ...webDefaults, mode: "batch", urls: "https://a.org/x", tags: ["policy"] })).toMatchObject({ tags: ["policy"] });
  });

  it("checks host patterns and reads the host from host_not_allowed", () => {
    expect(validateHostPattern("*.example.org")).toBeUndefined();
    expect(validateHostPattern("example.org")).toBeUndefined();
    expect(validateHostPattern("*")).toMatch(/specific domain/);
    expect(validateHostPattern("*", { allowStar: true })).toBeUndefined();
    expect(validateHostPattern("https://example.org/x")).toMatch(/without https/);
    expect(validateHostPattern("example")).toMatch(/Use a host/);
    const err = new ApiError(400, "host_not_allowed", "www.example.org is not on the crawl allowlist. A team editor can request it.");
    expect(hostFromError(err, [])).toBe("www.example.org");
    expect(hostFromError(new ApiError(400, "host_not_allowed", "Not allowed"), ["https://news.example.org/a"])).toBe("news.example.org");
  });

  it("formats durations and throttles progress announcements", () => {
    expect(formatDuration("2026-09-25T10:00:00Z", "2026-09-25T10:00:45Z")).toBe("45 s");
    expect(formatDuration("2026-09-25T10:00:00Z", "2026-09-25T10:03:05Z")).toBe("3 min 5 s");
    expect(formatDuration(null, null)).toBe("—");
    expect(crawlAnnouncement(crawl({ pagesFetched: 57 }), 200)).toBe("Crawl running: at least 40 pages fetched of up to 200 pages.");
    expect(crawlAnnouncement(crawl({ pagesFetched: 59 }), 200)).toBe(crawlAnnouncement(crawl({ pagesFetched: 41 }), 200));
    expect(crawlAnnouncement(crawl({ status: "queued" }), 200)).toMatch(/queued/);
  });
});

/* ---------- create dialog ---------- */

describe("creating a web source", () => {
  it("validates the form, previews the pages and creates the source", async () => {
    const calls = mockApi({
      ...common,
      "POST /v1/teams/registrar/web/map": () => ({
        urls: ["https://registrar.example.edu/", "https://registrar.example.edu/calendar/", "https://registrar.example.edu/transcripts/"],
        truncated: true,
        sitemapUrls: 1,
      }),
      "POST /v1/teams/registrar/sources": (body) => ({ ...webSource(), name: (body as { name: string }).name }),
    });
    renderWith(<NewSource />, { role: "editor" });
    await userEvent.click(await screen.findByRole("button", { name: "New data source" }));
    // Step 1 chooses the type in a dialog; step 2 is a form page with Name, Classification and Profile first (W9).
    const chooser = await screen.findByRole("dialog", { name: "New data source" });
    await userEvent.click(within(chooser).getByRole("radio", { name: /Website/ }));
    await userEvent.click(within(chooser).getByRole("button", { name: "Continue" }));
    const dialog = await screen.findByRole("region", { name: "New website source" });
    const labels = within(dialog).getAllByText(/^(Name|Classification|Embedding profile|Start URLs)$/).map((el) => el.textContent);
    expect(labels.slice(0, 4)).toEqual(["Name", "Classification", "Embedding profile", "Start URLs"]);
    expect(within(dialog).getByRole("radio", { name: /Crawl a site/ })).toBeChecked();

    // Submitting empty shows errors on the fields and creates nothing.
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and start crawl" }));
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    const urls = within(dialog).getByRole("textbox", { name: "Start URLs" });
    expect(urls).toHaveAccessibleDescription(/Enter at least one start URL\./);
    await waitFor(() => expect(name).toHaveFocus());

    await userEvent.type(name, "Registrar website");
    await userEvent.type(urls, "not a url");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and start crawl" }));
    expect(urls).toHaveAccessibleDescription(/Not a valid web address: not a url\./);

    // Advanced options are collapsed with sensible defaults.
    const advanced = within(dialog).getByRole("button", { name: /Advanced crawl options/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(advanced).toHaveTextContent("Depth 2 · up to 200 pages · sitemaps on");
    await userEvent.click(advanced);
    expect(within(dialog).getByRole("spinbutton", { name: "Maximum depth" })).toHaveValue(2);
    expect(within(dialog).getByRole("switch", { name: "Use sitemaps" })).toBeChecked();

    await userEvent.clear(urls);
    await userEvent.type(urls, "https://registrar.example.edu/");
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview pages" }));
    const found = await within(dialog).findByText("3 pages found from the start URL, 1 of them from sitemaps. The crawl may fetch pages in a different order.");
    expect(found).toHaveAttribute("role", "status");
    expect(within(dialog).getByText(/Discovery stopped at the page limit/)).toBeInTheDocument();
    const list = within(dialog).getByRole("list", { name: "Discovered pages" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "https://registrar.example.edu/",
      "https://registrar.example.edu/calendar/",
      "https://registrar.example.edu/transcripts/",
    ]);
    expect(list).toHaveAttribute("tabindex", "0");
    expect(calls.find((c) => c.url === "/v1/teams/registrar/web/map")?.body).toEqual({
      url: "https://registrar.example.edu/",
      useSitemaps: true,
      limit: 200,
      includePrefixes: [],
      exclude: [],
      allowSubdomains: false,
    });
    expect(await axe(dialog)).toHaveNoViolations();

    await userEvent.click(within(dialog).getByRole("button", { name: "Create and start crawl" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/teams/registrar/sources")).toBe(true));
    expect(calls.find((c) => c.url === "/v1/teams/registrar/sources")?.body).toEqual({
      name: "Registrar website",
      description: "",
      type: "web",
      classification: "open",
      embeddingProfileId: "p1",
      web: {
        mode: "crawl",
        urls: ["https://registrar.example.edu/"],
        maxDepth: 2,
        maxPages: 200,
        includePrefixes: [],
        exclude: [],
        allowSubdomains: false,
        useSitemaps: true,
        schedule: "weekly",
        tags: [],
      },
    });
  });

  it("names the team's pending request instead of offering another (P-15)", async () => {
    mockApi({
      ...common,
      "POST /v1/teams/registrar/sources": () =>
        new ApiFailure(400, "host_not_allowed", "www.example.org is not on the crawl allowlist yet.", {
          host: "www.example.org",
          pendingRequest: { id: "r1", pattern: "*.example.org", createdAt: "2026-09-25T10:00:00Z", requesterName: "Una User" },
        }),
    });
    renderWith(<CreateSourcePage type="web" onClose={() => {}} />, { role: "editor" });
    const dialog = await screen.findByRole("region", { name: "New website source" });
    await userEvent.click(await within(dialog).findByRole("radio", { name: /Single page/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Example");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Page URL" }), "https://www.example.org/about");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and start crawl" }));
    const alert = await within(dialog).findByText(/request for/);
    expect(alert.closest("[role]")).toHaveTextContent("Your team's request for *.example.org is waiting for a platform admin.");
    expect(within(dialog).queryByRole("button", { name: "Request this domain" })).toBeNull();
  });

  it("offers a pre-filled domain request when the host isn't allowed", async () => {
    const calls = mockApi({
      ...common,
      "POST /v1/teams/registrar/sources": () =>
        new ApiFailure(400, "host_not_allowed", "www.example.org is not on the crawl allowlist. A team editor can request it under Domain requests."),
      "POST /v1/teams/registrar/domain-requests": (body) => ({
        id: "r1",
        teamId: "t1",
        teamSlug: "registrar",
        teamName: team.name,
        status: "pending",
        requestedBy: "u1",
        reviewedBy: null,
        reviewNote: "",
        reviewedAt: null,
        createdAt: "2026-09-25T10:00:00Z",
        ...(body as object),
      }),
    });
    renderWith(<CreateSourcePage type="web" onClose={() => {}} />, { role: "editor" });
    const dialog = await screen.findByRole("region", { name: "New website source" });
    await userEvent.click(await within(dialog).findByRole("radio", { name: /Single page/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Example");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Page URL" }), "https://www.example.org/about");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and start crawl" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("www.example.org isn't on the crawl allowlist");
    expect(within(alert).getByRole("link", { name: "View your team's domain requests" })).toHaveAttribute("href", "/teams/registrar/sources?tab=crawl-domains");
    await userEvent.click(within(alert).getByRole("button", { name: "Request this domain" }));

    const request = await screen.findByRole("dialog", { name: "Request a domain" });
    expect(within(request).getByRole("textbox", { name: "Host pattern" })).toHaveValue("www.example.org");
    await userEvent.click(within(request).getByRole("button", { name: "Send request" }));
    expect(within(request).getByRole("textbox", { name: "Reason" })).toHaveAccessibleDescription(/at least 10 characters/);
    expect(calls.some((c) => c.url.endsWith("/domain-requests"))).toBe(false);
    // The request dialog's form must not submit the source form it opened from
    // (React bubbles submit through the portal): only the first create POST.
    const sourcePosts = () => calls.filter((c) => c.method === "POST" && c.url === "/v1/teams/registrar/sources").length;
    expect(sourcePosts()).toBe(1);
    expect(screen.getByRole("dialog", { name: "Request a domain" })).toBeInTheDocument();

    await userEvent.type(within(request).getByRole("textbox", { name: "Reason" }), "Our partner site hosts shared policies.");
    await userEvent.click(within(request).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/teams/registrar/domain-requests")).toBe(true));
    expect(sourcePosts()).toBe(1);
    expect(calls.find((c) => c.url === "/v1/teams/registrar/domain-requests")?.body).toEqual({
      pattern: "www.example.org",
      reason: "Our partner site hosts shared policies.",
    });
    expect(await screen.findByText("Domain requested")).toBeInTheDocument();
  });
});

describe("web source detail", () => {
  it("searches pages and pages through them 50 at a time", async () => {
    const doc = (id: string) => ({ ...webRoutes(webSource())["GET /v1/teams/registrar/sources/s1/documents"]().items[0]!, id, title: `Page ${id}` });
    const calls = mockApi({
      ...webRoutes(webSource({ documents: { ...counts, total: 51, ready: 49 } })),
      "GET /v1/teams/registrar/sources/s1/documents": (_b, url) =>
        url.searchParams.get("cursor") === "next1"
          ? { items: [doc("p51")], nextCursor: null }
          : { items: Array.from({ length: 50 }, (_, i) => doc(`p${i + 1}`)), nextCursor: "next1" },
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /^Pages/ }));
    const nav = await screen.findByRole("navigation", { name: "Pages list navigation" });
    expect(screen.getByText("1–50 of 51")).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "Go to next page" }));
    expect(await screen.findByText("Page p51")).toBeInTheDocument();
    expect(screen.getByText("51–51 of 51")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Go to next page" })).toBeDisabled();
    await userEvent.click(within(nav).getByRole("button", { name: "Go to previous page" }));
    expect(await screen.findByText("Page p1")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search pages" }), "calendar");
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/documents") && new URLSearchParams(c.search).get("q") === "calendar")).toBe(true));
    const searched = calls.filter((c) => c.url.endsWith("/documents")).at(-1)!;
    expect(new URLSearchParams(searched.search).get("cursor")).toBeNull();
  });

  it("shows live crawl progress, confirms cancelling, and is accessible", async () => {
    const running = crawl();
    const calls = mockApi({
      ...webRoutes(webSource({ activeCrawl: running })),
      "POST /v1/teams/registrar/sources/s1/crawls/c1/cancel": () => ({ ...running, status: "cancelled", finishedAt: "2026-09-25T10:05:00Z" }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Registrar website" })).toBeInTheDocument();

    // Header facts line (instead of a Website card): the site's host, mode, schedule; Sync now is disabled with its reason.
    const site = screen.getAllByRole("link").find((l) => l.getAttribute("href") === "https://registrar.example.edu/")!;
    expect(site).toHaveAttribute("rel", "noreferrer");
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveTextContent("registrar.example.edu");
    expect(site).toHaveTextContent("(opens in a new tab)");
    expect(screen.queryByRole("region", { name: "Website" })).toBeNull();
    expect(screen.getByText("Crawl a site · depth 2 · up to 200 pages")).toBeInTheDocument();
    expect(screen.getByText(/^Weekly · next sync/)).toBeInTheDocument();
    const sync = screen.getByRole("button", { name: "Sync now" });
    expect(sync).toBeDisabled();
    expect(sync).toHaveAccessibleDescription("A crawl is running. You can sync again when it finishes.");

    // The active crawl panel.
    const panel = screen.getByRole("region", { name: "Crawl in progress" });
    const bar = within(panel).getByRole("progressbar", { name: "Pages fetched, of the page limit" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
    expect(within(panel).getByText("Running")).toBeInTheDocument();
    expect(within(panel).getByText("50 / 200")).toBeInTheDocument();
    expect(within(panel).getByText("Crawl running: at least 40 pages fetched of up to 200 pages.")).toHaveAttribute("role", "status");

    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(panel).getByRole("button", { name: "Cancel crawl" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Cancel this crawl?" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Keep crawling" })).toHaveFocus());
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel crawl" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/crawls/c1/cancel"))).toBe(true));
    expect(await screen.findByText("Crawl cancelled")).toBeInTheDocument();

    // The history (its own Crawls tab) explains truncation.
    await userEvent.click(screen.getByRole("tab", { name: "Crawls" }));
    const history = await screen.findByRole("table", { name: "Crawl history" });
    expect(within(history).getByRole("button", { name: /^Truncated: .*No pages are removed/ })).toBeInTheDocument();

    // Pages (their own tab): one-line titles with the URL path only (the host is in the facts line).
    await userEvent.click(screen.getByRole("tab", { name: /^Pages/ }));
    expect(within(await screen.findByRole("button", { name: "Academic calendar" })).getByText("Academic calendar")).toHaveAttribute("title", "Academic calendar");
    expect(screen.getByText("/calendar/")).toHaveAttribute("title", "https://registrar.example.edu/calendar/");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("starts a sync, and treats crawl_in_progress as the running crawl", async () => {
    const calls = mockApi({
      ...webRoutes(webSource()),
      "POST /v1/teams/registrar/sources/s1/sync": () => new ApiFailure(409, "crawl_in_progress", "A crawl is already running", { crawl: crawl({ status: "queued", startedAt: null }) }),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const sync = await screen.findByRole("button", { name: "Sync now" });
    expect(sync).toBeEnabled();
    await userEvent.click(sync);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/sync"))).toBe(true));
    expect(await screen.findByText("A crawl is already running")).toBeInTheDocument();
  });

  it("explains a paused source and hides editing from members", async () => {
    mockApi(webRoutes(webSource({ status: "paused", nextSyncAt: null })));
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    expect(await screen.findByText("This source is paused")).toBeInTheDocument();
    expect(screen.getByText("Weekly · no syncs while paused")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Crawl settings" })).toBeNull();
  });

  it("edits the crawl settings with If-Match", async () => {
    const calls = mockApi({
      ...webRoutes(webSource()),
      "PATCH /v1/teams/registrar/sources/s1": (body) => ({ ...webSource(), web: { ...webSource().web!, ...(body as { web: object }).web }, revision: 6 }),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const settings = await screen.findByRole("region", { name: "Crawling" });
    // One save bar for the whole tab, shown once something changes.
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Sync schedule" }), "daily");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.headers.get("If-Match")).toBe('"5"');
    expect((patch.body as { web: { schedule: string } }).web.schedule).toBe("daily");
  });
});
