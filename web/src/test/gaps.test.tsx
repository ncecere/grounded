/* The gap report (docs/gaps.md): the team's Gaps page, a topic's record page and its actions, the agent's Gaps view, the admin counts, and who sees it. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, meFor, mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { meWithEvals } from "./evaluations-fixtures";
import { GapsView } from "../pages/agents/analytics/gaps";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const T = { timeout: 5000 };

const topic: Schemas["GapTopic"] = {
  id: "gt1",
  agentId: "ag1",
  agentName: "Registrar assistant",
  label: "Parking permits",
  state: "open",
  stateReason: "",
  stateChangedAt: "2026-09-20T10:00:00Z",
  questions: 14,
  askers: 9,
  shared: 1,
  last30Days: 12,
  sinceClosed: 0,
  firstSeen: "2026-09-02T10:00:00Z",
  lastSeen: "2026-09-29T10:00:00Z",
  signals: { no_context: 10, thumbs_down: 3, refused: 1, uncited: 1 },
  reasons: { missing_sources: 3 },
  trend: [0, 0, 1, 1, 2, 3, 3, 4],
};

const detail: Schemas["GapTopicDetail"] = {
  topic,
  history: [],
  sharedQuestions: [{ id: "sq1", question: "Where do visitors buy a parking permit?", feedbackReason: "missing_sources", addedToEvaluations: false, createdAt: "2026-09-28T10:00:00Z" }],
};

function gapRoutes(teamRole = "editor", extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...shellRoutes("none", teamRole),
    "GET /v1/me": () => meWithEvals(teamRole),
    "GET /v1/teams/registrar/gap-topics": (_b, call) =>
      call.search.get("state") === "closed" ? { topics: [], pending: 0, ungrouped: 0, minAskers: 3 } : { topics: [topic], pending: 4, ungrouped: 1, minAskers: 3 },
    "GET /v1/teams/registrar/gap-topics/gt1": () => detail,
    ...extra,
  };
}

describe("the Gaps page", () => {
  it("lists topics without question text, with signals and trend, beside Evaluations in the sidebar", async () => {
    mockApi(gapRoutes());
    const { container } = renderApp("/teams/registrar/gaps");
    const table = await screen.findByRole("table", { name: "Topics" }, T);
    const row = (await within(table).findByRole("link", { name: "Parking permits" }, T)).closest("tr")!;
    expect(row).toHaveTextContent("Registrar assistant");
    expect(row).toHaveTextContent("Nothing found · 10");
    // Two reasons, and how many more the topic's page lists (own-11).
    expect(row).toHaveTextContent("+2 more");
    expect(row).toHaveTextContent("14 questions");
    expect(row).toHaveTextContent("9 people");
    expect(within(row).getByRole("img", { name: /Questions per week, last 8 weeks: 14 in all, 4 this week\./ })).toBeInTheDocument();
    // Which failed questions aren't shown, and why (own-12).
    expect(screen.getByText("4 failed questions from the last 30 days aren't shown.")).toBeInTheDocument();
    expect(screen.getByText("3 are in topics fewer than 3 people asked about. 1 isn't grouped yet: questions are grouped every hour.")).toBeInTheDocument();
    // The breadcrumb names the page (own-9).
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Gaps")).toBeInTheDocument();
    expect(screen.queryByText(/visitors buy/)).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Gaps" })).toHaveAttribute("aria-current", "page");
    const items = within(nav).getAllByRole("link").map((l) => l.textContent);
    expect(items.indexOf("Gaps")).toBe(items.indexOf("Evaluations") + 1);
    expect(screen.getByRole("tab", { name: /Open/, selected: true })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(await screen.findByText("No closed topics.")).toBeInTheDocument();
  });

  it("opens a topic with its shared questions; Mark fixed, Dismiss with a reason and Add a source", async () => {
    const calls = mockApi(
      gapRoutes("editor", {
        "POST /v1/teams/registrar/gap-topics/gt1/fix": () => ({ ...topic, state: "fixed" }),
        "POST /v1/teams/registrar/gap-topics/gt1/dismiss": () => ({ ...topic, state: "dismissed" }),
        "POST /v1/teams/registrar/gap-topics/gt1/add-source": () => topic,
        "GET /v1/teams/registrar/sources": () => [],
        "GET /v1/teams/registrar/kbs": () => [],
      }),
    );
    const { container, router } = renderApp("/teams/registrar/gaps?record=gt1");
    expect(await screen.findByRole("heading", { level: 1, name: "Parking permits" }, T)).toBeInTheDocument();
    expect(screen.getByText("Where do visitors buy a parking permit?")).toBeInTheDocument();
    expect(screen.getByText(/Thumbs-down reasons: Missing sources \(3\)\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to evaluations" })).toBeInTheDocument();
    // One primary action: Add a source; the others are secondary.
    expect(screen.getByRole("button", { name: "Mark fixed" })).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveAttribute("data-variant", "secondary");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Mark fixed" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/gt1/fix"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("dialog", { name: "Dismiss this topic?" });
    // Two kinds (owner decision 5); the reason says who sees it (aud-2).
    expect(within(dialog).getByRole("radio", { name: /Dismiss for now/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Not for this agent/ }));
    expect(within(dialog).getByText("Kept in the topic's history. Only your team's editors, admins and owners see it.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Visitors park free.");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("/gt1/dismiss"))?.body).toEqual({ kind: "not_for_agent", reason: "Visitors park free." }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a source" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(calls.some((c) => c.url.endsWith("/gt1/add-source"))).toBe(true);
    expect(await screen.findByText("Add a source about Parking permits.", undefined, T)).toBeInTheDocument();
  });

  it("shows a closed topic's history with who and why, says what joined since, and reopens it", async () => {
    const closed = { ...topic, state: "dismissed" as const, dismissKind: "not_for_agent" as const, sinceClosed: 3 };
    const calls = mockApi(
      gapRoutes("editor", {
        "GET /v1/teams/registrar/gap-topics/gt1": () => ({
          ...detail,
          topic: closed,
          history: [
            { id: "e2", kind: "dismissed", dismissKind: "not_for_agent", reason: "Transport answers parking.", by: "Casey Lee", at: "2026-10-01T10:00:00Z" },
            { id: "e1", kind: "reopened", reason: "", at: "2026-09-30T10:00:00Z" },
            { id: "e0", kind: "dismissed", dismissKind: "for_now", reason: "Covered elsewhere.", by: "Alex Kim", at: "2026-09-29T10:00:00Z" },
          ],
        }),
        "POST /v1/teams/registrar/gap-topics/gt1/reopen": () => topic,
      }),
    );
    const { container } = renderApp("/teams/registrar/gaps?tab=closed&record=gt1");
    expect(await screen.findByRole("heading", { level: 1, name: "Parking permits" }, T)).toBeInTheDocument();
    expect(screen.getAllByText("Not for this agent").length).toBeGreaterThan(0);
    expect(screen.getByText("3 more since dismissed")).toBeInTheDocument();
    expect(screen.getByText(/Not for this agent by Casey Lee/)).toBeInTheDocument();
    expect(screen.getByText("Reason: Transport answers parking.")).toBeInTheDocument();
    expect(screen.getByText(/Reopened by a new failed question/)).toBeInTheDocument();
    expect(screen.getByText("Reason: Covered elsewhere.")).toBeInTheDocument();
    // Back to the Gaps page, not the tab it was opened from (aud-11).
    expect(screen.getByRole("link", { name: "Back to Gaps" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/gt1/reopen"))).toBe(true));
  });

  it("turns on confirming similar questions with SystemOne in Settings, or says it needs a SystemOne model", async () => {
    const calls = mockApi(
      gapRoutes("editor", {
        "GET /v1/teams/registrar/gap-settings": () => ({ confirmSimilar: false, revision: 1 }),
        "PUT /v1/teams/registrar/gap-settings": (b) => ({ ...(b as object), revision: 2 }),
        "GET /v1/systemone/status": () => ({ available: true }),
      }),
    );
    const { container } = renderApp("/teams/registrar/gaps?tab=settings");
    const toggle = await screen.findByRole("switch", { name: "Confirm similar questions with SystemOne" }, T);
    expect(toggle).not.toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ confirmSimilar: true }));
    expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toMatch(/1/);
  });

  it("adds a shared question to one of the agent's evaluation sets, or says to create one", async () => {
    mockApi(gapRoutes("editor", { "GET /v1/teams/registrar/evaluation-sets": () => [] }));
    renderApp("/teams/registrar/gaps?record=gt1");
    await userEvent.click(await screen.findByRole("button", { name: "Add to evaluations" }, T));
    const dialog = await screen.findByRole("dialog", { name: "Add to evaluations" });
    expect(await within(dialog).findByText("Registrar assistant has no evaluation set yet.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add question" })).toBeDisabled();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it("is not for members, and not in their sidebar", async () => {
    mockApi(gapRoutes("member", { "GET /v1/me": () => meFor("none", "member") }));
    renderApp("/teams/registrar/gaps");
    expect(await screen.findByText("Only editors, admins and owners can see gaps.", undefined, T)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Gaps" })).toBeNull();
  });
});

describe("the agent's Gaps view", () => {
  it("lists the agent's open topics, linking to the team's Gaps page", async () => {
    const calls = mockApi({ "GET /v1/teams/registrar/gap-topics": () => ({ topics: [topic], pending: 0, ungrouped: 0, minAskers: 3 }) });
    const { container } = renderBare(<GapsView team="registrar" agentId="ag1" agentName="Registrar assistant" />);
    const link = await screen.findByRole("link", { name: "Parking permits" });
    expect(link).toHaveAttribute("href", "/teams/registrar/gaps?record=gt1");
    expect(calls[0]!.search.get("agentId")).toBe("ag1");
    expect(calls[0]!.search.get("state")).toBe("open");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Admin → Analytics", () => {
  it("shows failed questions per team, counts only", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/analytics/gaps": () => ({
        from: "2026-09-01",
        to: "2026-09-30",
        questions: 21,
        teams: [{ teamId: "t1", slug: "registrar", name: "Office of the Registrar", questions: 21, signals: { no_context: 15, thumbs_down: 4 } }],
      }),
    });
    const { FailedQuestions } = await import("../pages/admin/analytics/gaps");
    const { container } = renderBare(<FailedQuestions range={{ from: "2026-09-01", to: "2026-09-30" }} audience="public" />, meFor("platform_admin"));
    const table = await screen.findByRole("table", { name: "Failed questions per team" });
    expect(within(table).getByRole("row", { name: /Office of the Registrar 21 Nothing found \(15\), Thumbs-down \(4\)/ })).toBeInTheDocument();
    // The card follows the page's Audience filter (aud-10).
    expect(calls.find((c) => c.url === "/v1/admin/analytics/gaps")?.search.get("audience")).toBe("public");
    expect(await axe(container)).toHaveNoViolations();
  });
});
