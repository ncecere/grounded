/* #132: a team whose cost tracking is Off answers GET /v1/teams/{team}/spend with 404 costs_off; the pages do not ask again on every visit. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { forgetTeamSpend } from "../lib/costs";
import { useTeamSpend } from "../pages/team/spend";
import { Reply, mockApi } from "./harness";

afterEach(() => vi.unstubAllGlobals());

function Page({ team }: { team: string }) {
  const spend = useTeamSpend(team);
  return <p>{spend.isPending ? "loading" : spend.off ? "off" : "on"}</p>;
}

const spendCalls = (calls: { url: string }[]) => calls.filter((c) => c.url === "/v1/teams/registrar/spend").length;

describe("a team's spend while its cost tracking is off", () => {
  it("is asked once, not again for every page opened afterwards", async () => {
    const calls = mockApi({ "GET /v1/teams/registrar/spend": () => Reply.error(404, "costs_off", "Cost tracking is off for this team") });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (n: number) => (
      <QueryClientProvider client={qc}>
        <Page key={n} team="registrar" />
      </QueryClientProvider>
    );
    const first = render(view(1));
    expect(await screen.findByText("off")).toBeInTheDocument();
    first.unmount();
    // Three more team pages, one after another.
    for (let i = 2; i <= 4; i++) {
      const next = render(view(i));
      expect(await screen.findByText("off")).toBeInTheDocument();
      next.unmount();
    }
    expect(spendCalls(calls)).toBe(1);
  });

  it("is asked again once a cost mode has changed", async () => {
    let on = false;
    const calls = mockApi({
      "GET /v1/teams/registrar/spend": () => (on ? { status: {}, timeZone: "UTC", from: "2026-10-01", to: "2026-10-16", total: null, agents: [], models: [] } : Reply.error(404, "costs_off", "Off")),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (
      <QueryClientProvider client={qc}>
        <Page team="registrar" />
      </QueryClientProvider>
    );
    render(ui).unmount();
    await waitFor(() => expect(spendCalls(calls)).toBe(1));
    on = true;
    act(() => forgetTeamSpend(qc));
    render(ui);
    expect(await screen.findByText("on")).toBeInTheDocument();
    expect(spendCalls(calls)).toBe(2);
  });
});
