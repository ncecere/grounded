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
  firstSeen: "2026-09-02T10:00:00Z",
  lastSeen: "2026-09-29T10:00:00Z",
  signals: { no_context: 10, thumbs_down: 3, refused: 1 },
  reasons: { missing_sources: 3 },
  trend: [0, 0, 1, 1, 2, 3, 3, 4],
};

const detail = {
  topic,
  sharedQuestions: [{ id: "sq1", question: "Where do visitors buy a parking permit?", feedbackReason: "missing_sources", addedToEvaluations: false, createdAt: "2026-09-28T10:00:00Z" }],
};

function gapRoutes(teamRole = "editor", extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...shellRoutes("none", teamRole),
    "GET /v1/me": () => meWithEvals(teamRole),
    "GET /v1/teams/registrar/gap-topics": (_b, call) =>
      call.search.get("state") === "closed" ? { topics: [], pending: 0, minAskers: 3 } : { topics: [topic], pending: 4, minAskers: 3 },
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
    expect(row).toHaveTextContent("14 questions");
    expect(row).toHaveTextContent("9 people");
    expect(within(row).getByRole("img", { name: /Questions per week, last 8 weeks: 14 in all, 4 this week\./ })).toBeInTheDocument();
    expect(screen.getByText("4 failed questions in the last 30 days aren't in a topic yet.")).toBeInTheDocument();
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
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Visitors park free.");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/gt1/dismiss"))?.body).toEqual({ reason: "Visitors park free." }));

    await userEvent.click(screen.getByRole("button", { name: "Add a source" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(calls.some((c) => c.url.endsWith("/gt1/add-source"))).toBe(true);
    expect(await screen.findByText("Add a source about Parking permits.", undefined, T)).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: /not found|can't find/i }, T)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Gaps" })).toBeNull();
  });
});

describe("the agent's Gaps view", () => {
  it("lists the agent's open topics, linking to the team's Gaps page", async () => {
    const calls = mockApi({ "GET /v1/teams/registrar/gap-topics": () => ({ topics: [topic], pending: 0, minAskers: 3 }) });
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
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/analytics/gaps": () => ({
        from: "2026-09-01",
        to: "2026-09-30",
        questions: 21,
        teams: [{ teamId: "t1", slug: "registrar", name: "Office of the Registrar", questions: 21, signals: { no_context: 15, thumbs_down: 4 } }],
      }),
    });
    const { FailedQuestions } = await import("../pages/admin/analytics/gaps");
    const { container } = renderBare(<FailedQuestions range={{ from: "2026-09-01", to: "2026-09-30" }} />, meFor("platform_admin"));
    const table = await screen.findByRole("table", { name: "Failed questions per team" });
    expect(within(table).getByRole("row", { name: /Office of the Registrar 21 Nothing found \(15\), Thumbs-down \(4\)/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
