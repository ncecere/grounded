/* The content health report (docs/content-health.md): the team's page, its states in words, findings, keyboard use, and who sees it; the admin switch and the audit wording. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { areaOf } from "../components/audit/labels";
import { targetTypeLabel } from "../components/audit/target-type-labels";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: scaled(5000) };
const base = "/v1/teams/registrar/content-health/reports";

const limits: Schemas["ContentHealthLimits"] = {
  defaultStaleDays: 365, minStaleDays: 30, maxStaleDays: 3650, defaultCitationWindowDays: 90, minCitationWindowDays: 14, maxCitationWindowDays: 365,
  minAnswers: 50, maxFindingsPerSignal: 1000, keepReports: 5, retentionDays: 30, cooldownSeconds: 600, pageSize: 100,
};
const sig = (over: Partial<Schemas["ContentHealthSignal"]> & Pick<Schemas["ContentHealthSignal"], "signal">): Schemas["ContentHealthSignal"] => ({
  state: "measured", reason: "", found: 0, listed: 0, truncated: false, counts: {}, ...over,
});
const report = (over: Partial<Schemas["ContentHealthReport"]> = {}): Schemas["ContentHealthReport"] => ({
  id: "r1", status: "completed", staleDays: 365, citationWindowDays: 90, asOf: "2026-10-30T12:00:00Z", createdAt: "2026-10-30T12:00:00Z", startedAt: "2026-10-30T12:00:00Z",
  finishedAt: "2026-10-30T12:01:00Z", expiresAt: "2026-11-29T12:01:00Z", errorCode: "",
  signals: [
    sig({ signal: "stale", found: 2, listed: 2 }),
    sig({ signal: "broken_link", found: 1, listed: 1, counts: { sourcesObserved: 1, sourcesUnknown: 1 } }),
    sig({ signal: "duplicate", found: 0 }),
    sig({ signal: "never_cited", state: "unavailable", reason: "too_few_answers", counts: { answers: 12, minAnswers: 50 } }),
    sig({ signal: "ingestion_failure", found: 1, listed: 1 }),
  ],
  ...over,
});
const finding = (over: Partial<Schemas["ContentHealthFinding"]>): Schemas["ContentHealthFinding"] => ({
  signal: "stale", ord: 1, sourceId: "s1", sourceName: "Handbook", sourceType: "upload", documentId: "d1", title: "Parking policy", filename: "parking.md", url: "", kind: "markdown",
  ref: "", groupNo: 0, groupSize: 0, code: "", detail: "", value: 800, observedAt: "2024-08-01T00:00:00Z", changedSinceReport: false, ...over,
});
const coverage: Schemas["ContentHealthSourceCoverage"][] = [
  {
    sourceId: "s1", name: "Handbook", type: "upload", documents: 10, ready: 9, readyWithoutDate: 1, readyWithoutHash: 0, linkState: "not_applicable", linkReason: "", linkTruncated: false, linkFailed: 0,
    linkRefs: "none", citeState: "judged", exposedSince: "2026-08-02T00:00:00Z", exposureAnswers: 120,
  },
  {
    sourceId: "s2", name: "Registrar site", type: "web", documents: 40, ready: 40, readyWithoutDate: 0, readyWithoutHash: 0, linkState: "unknown", linkReason: "page_refetch_latest", linkTruncated: false, linkFailed: 0,
    linkRefs: "none", citeState: "not_served", exposedSince: null, exposureAnswers: 0,
  },
  {
    sourceId: "s3", name: "Library site", type: "web", documents: 5, ready: 5, readyWithoutDate: 0, readyWithoutHash: 0, linkState: "observed", linkReason: "", linkTruncated: false, linkFailed: 2,
    linkRefs: "crawl_changed", citeState: "too_few_answers", exposedSince: "2026-10-20T00:00:00Z", exposureAnswers: 12,
  },
];

function routes(over: Record<string, Handler> = {}, teamRole = "editor", rep = report(), enabled = true): Record<string, Handler> {
  return {
    ...shellRoutes("none", teamRole),
    // While off the list holds stubs: no signal, count or finding.
    [`GET ${base}`]: () => ({ enabled, limits, reports: enabled ? [rep] : [{ ...rep, signals: [] }] }),
    [`GET ${base}/${rep.id}`]: () => ({ report: rep, sources: coverage }),
    [`GET ${base}/${rep.id}/findings`]: (_b, call) =>
      call.search.get("signal") === "broken_link"
        ? { items: [finding({ signal: "broken_link", documentId: null, title: "", filename: "", ref: "https://example.edu/old-page", code: "not_found", value: 404, sourceId: "s2", sourceName: "Registrar site" })], nextCursor: null }
        : { items: [finding({}), finding({ ord: 2, title: "Housing", documentId: "d2", changedSinceReport: true })], nextCursor: call.search.get("cursor") ? null : "Mg" },
    "GET /v1/teams/registrar/sources": () => [{ id: "s1", name: "Handbook" }],
    "GET /v1/teams/registrar/kbs": () => [{ id: "k1", name: "Student help" }],
    ...over,
  };
}

describe("Team → Content health", () => {
  it("says what the report is and is not, and what each signal does not mean", async () => {
    mockApi(routes());
    const { container } = renderApp("/teams/registrar/content-health");
    expect(await screen.findByRole("heading", { level: 1, name: "Content health" }, T)).toBeInTheDocument();
    expect(screen.getByText(/a list of places to look, not a score of quality/)).toBeInTheDocument();
    expect(await screen.findByText(/No website is fetched, no AI model is used, and nothing is changed or deleted/, undefined, T)).toBeInTheDocument();
    expect(screen.getByText(/hared platform sources are not included/)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const cards = within(list).getAllByRole("listitem") as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(cards).toHaveLength(5);
    expect(within(cards[0]).getByText("2")).toBeInTheDocument();
    // A zero is shown only for a measured signal.
    expect(within(cards[2]).getByText("0")).toBeInTheDocument();
    expect(within(cards[2]).getByText("No file appears in two sources.")).toBeInTheDocument();
    // A signal that could not be measured says why, never a zero.
    expect(within(cards[3]).getByText("Unavailable")).toBeInTheDocument();
    expect(within(cards[3]).getByText("No retained citation evidence")).toBeInTheDocument();
    expect(within(cards[3]).getByText("Too few kept answers that could have cited something, team-wide, to say which documents have no citation evidence.")).toBeInTheDocument();
    expect(within(cards[3]).queryByText("0")).toBeNull();
    expect(within(cards[3]).getByRole("button", { name: /Show findings/ })).toBeDisabled();
    // The limits of each signal are one click away.
    await userEvent.click(within(cards[0]).getByRole("button", { name: "What this does not mean" }));
    expect(within(cards[0]).getByText(/not when someone last edited it/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a signal's findings with live names, pages by keyboard, and never links an address that failed", async () => {
    const calls = mockApi(routes());
    const { container } = renderApp("/teams/registrar/content-health");
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const btn = within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: /Show findings/ });
    btn.focus();
    await userEvent.keyboard("{Enter}");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    const table = await screen.findByRole("table", { name: "Not processed in a long time: findings" }, T);
    const first = within(table).getByRole("link", { name: "Parking policy" });
    expect(first).toHaveAttribute("href", "/teams/registrar/sources/s1");
    expect(within(table).getByText("Changed since this report")).toBeInTheDocument();
    expect(within(table).getAllByText("(800 days)", { exact: false })).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/findings") && c.search.get("cursor") === "Mg")).toBe(true));
    expect(calls.every((c) => c.url !== base + "/r1/findings" || c.search.get("limit") === "25")).toBe(true);

    await userEvent.click(within(within(list).getAllByRole("listitem")[1]!).getByRole("button", { name: /Show findings/ }));
    const links = await screen.findByRole("table", { name: "Links that failed in the last crawl: findings" }, T);
    expect(within(links).getByText("https://example.edu/old-page")).toBeInTheDocument();
    expect(within(links).queryByRole("link", { name: /example\.edu\/old-page/ })).toBeNull();
    expect(within(links).getByText(/Not found \(404 or 410\)/)).toBeInTheDocument();
  });

  it("says where each source's links are unknown, and does not claim none are broken", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/content-health");
    const table = await screen.findByRole("table", { name: "Sources in this report" }, T);
    expect(within(table).getByText(/Unknown: the latest crawl was a single-page re-fetch/)).toBeInTheDocument();
    expect(within(table).getByText(/Not applicable \(not a web source\)/)).toBeInTheDocument();
    expect(within(table).getByText(/1 without a date/)).toBeInTheDocument();
  });

  it("shows what the report could see of each source as of the report, hides addresses that no longer hold, and says why a source was not judged", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/content-health");
    const table = await screen.findByRole("table", { name: "Sources in this report" }, T);
    expect(within(table).getByText(/Judged: 120 kept answers could have cited it since it became reachable/)).toBeInTheDocument();
    expect(within(table).getByText(/Not judged: no published agent reaches it through a knowledge base/)).toBeInTheDocument();
    expect(within(table).getByText(/Not judged: 12 kept answers since it became reachable, fewer than 50/)).toBeInTheDocument();
    expect(within(table).getByText(/Its addresses are hidden: a newer crawl has replaced that observation/)).toBeInTheDocument();
    expect(screen.getByText(/The counts on the cards and in the source table are as of when the report was made/)).toBeInTheDocument();
  });

  it("states that no retained citation evidence is a team-wide window, not a fair-exposure or quality claim, and lists what was left out", async () => {
    const measured = report({
      signals: [
        sig({ signal: "stale" }), sig({ signal: "broken_link" }), sig({ signal: "duplicate" }),
        sig({
          signal: "never_cited", found: 3, listed: 3, observedSince: "2026-08-01T00:00:00Z",
          counts: { answers: 340, minAnswers: 50, judged: 12, tooNew: 2, notServed: 7, fewAnswers: 4, sourcesJudged: 2 },
        }),
        sig({ signal: "ingestion_failure" }),
      ],
    });
    const calls = mockApi(
      routes(
        {
          [`GET ${base}/r1/findings`]: () => ({ items: [finding({ signal: "never_cited", value: 340, title: "Old policy" })], nextCursor: null }),
        },
        "editor",
        measured,
      ),
    );
    renderApp("/teams/registrar/content-health");
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const card = within(list).getAllByRole("listitem")[3]!;
    expect(within(card).getByText("No retained citation evidence")).toBeInTheDocument();
    expect(within(card).getByText(/Not a quality or fair-exposure claim/)).toBeInTheDocument();
    expect(within(card).getByText(/Team-wide window since/)).toBeInTheDocument();
    expect(within(card).getByText(/not the time any document became reachable/)).toBeInTheDocument();
    expect(within(card).getByText(/340 kept answers could have cited something/)).toBeInTheDocument();
    expect(card).toHaveTextContent("7 that no published agent reaches");
    expect(card).toHaveTextContent("4 whose source saw too few answers");
    await userEvent.click(within(card).getByRole("button", { name: "What this does not mean" }));
    expect(within(card).getByText(/not a claim that the document had a fair chance of being cited/)).toBeInTheDocument();
    expect(screen.getByText(/Team-wide, up to 90 days, from the team's first kept answer/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: /Show findings/ }));
    const table = await screen.findByRole("table", { name: "No retained citation evidence: findings" }, T);
    expect(within(table).getByText("340")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Kept answers that could have cited its source");
    expect(calls.some((c) => c.search.get("signal") === "never_cited")).toBe(true);
    // Never "never cited".
    expect(screen.queryByText(/never cited/i)).toBeNull();
  });

  it("counts duplicates in groups on both sides, and says how many groups still hold", async () => {
    const dup = report({ signals: [sig({ signal: "stale" }), sig({ signal: "broken_link" }), sig({ signal: "duplicate", found: 3, listed: 1 }), sig({ signal: "never_cited", state: "not_applicable", reason: "no_documents" }), sig({ signal: "ingestion_failure" })] });
    mockApi(routes({}, "editor", dup));
    renderApp("/teams/registrar/content-health");
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const card = within(list).getAllByRole("listitem")[2]!;
    expect(card).toHaveTextContent("3 groups");
    expect(card).toHaveTextContent("1 group still listed now");
  });

  it("flags a page a crawl recently confirmed instead of presenting it as neglected", async () => {
    const stale = report({ signals: [sig({ signal: "stale", found: 2, listed: 2, counts: { recentlyConfirmed: 1 } }), sig({ signal: "broken_link", state: "not_applicable", reason: "no_web_sources" }), sig({ signal: "duplicate", state: "not_applicable", reason: "one_source" }), sig({ signal: "never_cited", state: "not_applicable", reason: "no_documents" }), sig({ signal: "ingestion_failure" })] });
    mockApi(
      routes(
        {
          [`GET ${base}/r1/findings`]: () => ({
            items: [finding({ confirmedAt: "2026-10-20T00:00:00Z" }), finding({ ord: 2, title: "Housing", documentId: "d2", confirmedAt: "2024-01-01T00:00:00Z" })],
            nextCursor: null,
          }),
        },
        "editor",
        stale,
      ),
    );
    renderApp("/teams/registrar/content-health");
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const card = within(list).getAllByRole("listitem")[0]!;
    expect(card).toHaveTextContent("1 of these were seen again by a crawl within the threshold");
    await userEvent.click(within(card).getByRole("button", { name: /Show findings/ }));
    const table = await screen.findByRole("table", { name: "Not processed in a long time: findings" }, T);
    expect(within(table).getAllByText("Recently confirmed by a crawl")).toHaveLength(1);
  });

  it("explains that an address is shown without credentials, query or fragment", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/content-health");
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    await userEvent.click(within(within(list).getAllByRole("listitem")[1]!).getByRole("button", { name: /Show findings/ }));
    expect(await screen.findByText(/without credentials, query or fragment. The path can still contain something sensitive/, undefined, T)).toBeInTheDocument();
  });

  it("makes a report with the chosen scope and thresholds, validates them, and shows the server's refusal", async () => {
    let refuse = true;
    const calls = mockApi(
      routes({
        [`POST ${base}`]: () => (refuse ? Reply.error(429, "content_health_wait", "A report was made a moment ago. Try again in a few minutes.") : report({ id: "r2", status: "queued", signals: [] })),
      }),
    );
    renderApp("/teams/registrar/content-health");
    const scope = await screen.findByRole("combobox", { name: /What to look at/ }, T);
    await screen.findByRole("option", { name: "Handbook" }, T);
    await userEvent.selectOptions(scope, "Handbook");
    const stale = screen.getByRole("textbox", { name: /Not processed for/ });
    await userEvent.clear(stale);
    await userEvent.type(stale, "10");
    expect(screen.getByText("Enter a whole number from 30 to 3650.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make report" })).toBeDisabled();
    await userEvent.clear(stale);
    await userEvent.type(stale, "90");
    await userEvent.click(screen.getByRole("button", { name: "Make report" }));
    expect(await screen.findByText("A report was made a moment ago. Try again in a few minutes.", undefined, T)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ staleDays: 90, citationWindowDays: 90, sourceId: "s1" });
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Make report" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
  });

  it("shows a report in progress with Cancel, and cancels it", async () => {
    const running = report({ status: "running", signals: [], finishedAt: null, expiresAt: null });
    const calls = mockApi(routes({ [`POST ${base}/r1/cancel`]: () => report({ status: "cancelled", signals: [] }) }, "editor", running));
    const { container } = renderApp("/teams/registrar/content-health");
    expect(await screen.findByText("The report is made in the background. This page updates by itself; you can leave it.", undefined, T)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make report" })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Cancel report" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/r1/cancel"))).toBe(true));
  });

  it("says why a report failed, and deletes one after confirming", async () => {
    const failed = report({ status: "failed", errorCode: "too_many_sources", signals: [] });
    const calls = mockApi(routes({ [`DELETE ${base}/r1`]: () => new Response(null, { status: 204 }) }, "owner", failed));
    renderApp("/teams/registrar/content-health");
    expect(await screen.findByText(/more sources than one report covers/, undefined, T)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete report" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Your documents and sources are not touched");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete report" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("says it is switched off, and offers nothing to make or read", async () => {
    mockApi(routes({}, "editor", report(), false));
    renderApp("/teams/registrar/content-health");
    expect(await screen.findByText("Content health reports are switched off.", undefined, T)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make report" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Signals" })).toBeNull();
  });

  it("while off, still lets the team delete a kept report and stop one being made, and shows nothing it found", async () => {
    const running = report({ id: "r2", status: "running", signals: [], finishedAt: null, expiresAt: null });
    const calls = mockApi(
      routes(
        {
          [`GET ${base}`]: () => ({ enabled: false, limits, reports: [running, { ...report(), signals: [] }] }),
          [`POST ${base}/r2/cancel`]: () => ({ ...running, status: "cancelled" }),
          [`DELETE ${base}/r1`]: () => new Response(null, { status: 204 }),
        },
        "editor",
        report(),
        false,
      ),
    );
    const { container } = renderApp("/teams/registrar/content-health");
    const table = await screen.findByRole("table", { name: "Reports still kept" }, T);
    expect(screen.queryByRole("list", { name: "Signals" })).toBeNull();
    expect(within(table).queryByText(/Parking|Handbook/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(table).getByRole("button", { name: "Cancel report" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/r2/cancel"))).toBe(true));
    await userEvent.click(within(table).getByRole("button", { name: "Delete report" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete report" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/r1"))).toBe(true));
    expect(calls.some((c) => c.url.includes("/findings") || c.url.endsWith("/r1"))).toBe(calls.some((c) => c.method === "DELETE"));
  });

  it("is for editors, admins and owners: members are told so, and it is in the sidebar only for those who can open it", async () => {
    mockApi(routes({}, "member"));
    renderApp("/teams/registrar/content-health");
    expect(await screen.findByText("Only editors, admins and owners can see content health reports.", undefined, T)).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Content health" })).toBeNull();
  });

  it("is in the sidebar for an editor, after Gaps", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/content-health");
    const nav = await screen.findByRole("navigation", { name: "Main" }, T);
    const items = within(nav).getAllByRole("link").map((l) => l.textContent);
    expect(items.indexOf("Content health")).toBe(items.indexOf("Gaps") + 1);
    expect(within(nav).getByRole("link", { name: "Content health" })).toHaveAttribute("aria-current", "page");
    expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" })).findByText("Content health", undefined, T)).toBeInTheDocument();
  });

  it("stacks its tables on a phone: every cell is named by its column", async () => {
    mockApi(routes());
    renderApp("/teams/registrar/content-health");
    const table = await screen.findByRole("table", { name: "Sources in this report" }, T);
    const columns = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(columns).toEqual(["Source", "Documents", "Ready", "Links", "Citation evidence", "Not judged"]);
  });
});

describe("Admin → Settings › Features › Content health reports", () => {
  const settings = (over: Partial<Schemas["ContentHealthSettings"]> = {}): Schemas["ContentHealthSettings"] => ({ enabled: false, revision: 3, updatedAt: "2026-10-30T10:00:00Z", ...over });

  it("is off by default, turns on with the revision, and asks before turning off", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/settings/content-health": () => settings(),
      "PUT /v1/admin/settings/content-health": (b) => settings({ ...(b as object), revision: 4 }),
    });
    renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow content health reports" }, T);
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: true });
    expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toBe('"3"');
    await waitFor(() => expect(screen.getByRole("switch", { name: "Allow content health reports" })).toBeChecked());
    await userEvent.click(screen.getByRole("switch", { name: "Allow content health reports" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("kept");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("is read-only for an auditor, who is told why", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/settings/content-health": () => settings({ enabled: true }) });
    renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow content health reports" }, T);
    expect(sw).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("Only platform admins can turn this on or off.").length).toBeGreaterThan(0);
  });
});

describe("The audit log's words", () => {
  it("names the actions and targets, in their own area", () => {
    expect(areaOf("content_health.generate")).toBe("Content health");
    expect(targetTypeLabel("content_health_report")).toBe("Content health report");
    expect(targetTypeLabel("content_health_settings")).toBe("Content health setting");
  });
});
