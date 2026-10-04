/* Wording found in the v0.4.1 bug hunt (AD-36): a kill-switch reason ends its sentence; an archived team's empty sources say why nothing can be added. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { EditorAlerts } from "../pages/agents/editor-header";
import type { Agent } from "../pages/agents/common";
import { TeamContext, teamCtx } from "../pages/team/common";
import { SourcesPage } from "../pages/team/sources";
import { common, mockApi, team } from "./web-harness";

afterEach(() => vi.unstubAllGlobals());

function renderInTeam(ui: ReactNode, archived: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], { user: { id: "u1", email: "u1@example.edu", displayName: "Una", platformRole: "none", status: "active" }, teams: [], csrfToken: "c", capabilities: { platformAdmin: false, platformAuditor: false } });
  const ctx = teamCtx({ ...team, status: archived ? "archived" : "active" }, "owner");
  const root = createRootRoute({ component: () => <TeamContext.Provider value={ctx}>{ui}</TeamContext.Provider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("wording (AD-36)", () => {
  it("ends a platform kill switch's reason with a full stop before the next sentence", () => {
    const agent = { status: "disabled_by_platform", disabledReason: "Beta kill switch test", warnings: [] } as unknown as Agent;
    render(<EditorAlerts current={agent} d={{ conflict: null, status: "idle" } as never} onProblem={() => {}} />);
    expect(screen.getByText(/Nobody can chat with this agent/)).toHaveTextContent(
      "Nobody can chat with this agent. Reason: Beta kill switch test. Only a platform admin can enable it.",
    );
  });

  it("says an archived team's sources can't grow, instead of who could create them", async () => {
    mockApi({ ...common, "GET /v1/teams/registrar/sources": () => [], "GET /v1/teams/registrar/kbs": () => [] });
    renderInTeam(<SourcesPage />, true);
    expect(await screen.findByText("This team is archived: nothing new can be added.")).toBeInTheDocument();
    expect(screen.queryByText("Editors, admins and owners can create data sources.")).toBeNull();
  });
});
