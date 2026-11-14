/*
 * Route loaders (#252, route-data.ts): preloading the agent editor, a source or a knowledge base (a hover, with
 * defaultPreload "intent") asks for its record and its team, the page then opens on that answer within the app's 15 s
 * freshness, and a record that is missing or refused still renders the page's own not-found or error state.
 */
import { screen, waitFor } from "@testing-library/react";
import { Reply, mockApi, renderApp, shellRoutes } from "./harness";

const gets = (calls: { method: string; url: string }[], url: string) => calls.filter((c) => c.method === "GET" && c.url === url).length;

const kb = {
  id: "k1", name: "Student handbook", description: "", embeddingProfileId: "p1", topK: 8, sources: [],
  effectiveClassification: "open", revision: 2, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
};
const routes = (extra: Record<string, () => unknown> = {}) => ({
  ...shellRoutes("none", "owner"),
  "GET /v1/teams/registrar/kbs/k1": () => kb,
  "GET /v1/teams/registrar/kbs/k1/profile-migration": () => null,
  "GET /v1/teams/registrar/sources": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/shared-sources": () => [],
  "GET /v1/teams/registrar/agents": () => [],
  ...extra,
});

describe("route loaders", () => {
  it.each([
    ["/teams/registrar/kbs/k1", "/v1/teams/registrar/kbs/k1"],
    ["/teams/registrar/sources/s1", "/v1/teams/registrar/sources/s1"],
    ["/teams/registrar/agents/a1", "/v1/teams/registrar/agents/a1"],
  ])("preloading %s asks for its record and its team before the page mounts", async (href, record) => {
    const calls = mockApi({ ...routes(), "GET /v1/agents": () => [] });
    const { router } = renderApp("/");
    await screen.findByRole("main");
    await waitFor(() => expect(router.state.status).toBe("idle"));
    const before = gets(calls, record);
    await router.preloadRoute({ to: href } as never);
    expect(before).toBe(0);
    expect(gets(calls, record)).toBe(1);
    expect(gets(calls, "/v1/teams/registrar")).toBeGreaterThanOrEqual(1);
  });

  it("opens a preloaded knowledge base on the loader's answer, without asking again", async () => {
    const calls = mockApi({ ...routes(), "GET /v1/agents": () => [] });
    const { router } = renderApp("/");
    await screen.findByRole("main");
    await router.preloadRoute({ to: "/teams/registrar/kbs/k1" } as never);
    await router.navigate({ href: "/teams/registrar/kbs/k1" });
    expect(await screen.findByRole("heading", { level: 1, name: "Student handbook" })).toBeInTheDocument();
    expect(gets(calls, "/v1/teams/registrar/kbs/k1")).toBe(1);
    expect(gets(calls, "/v1/teams/registrar")).toBe(1);
  });

  it("still shows the page's not-found state for a missing agent", async () => {
    mockApi(routes({ "GET /v1/teams/registrar/agents/gone": () => Reply.error(404, "not_found", "Not found.") }));
    renderApp("/teams/registrar/agents/gone");
    expect(await screen.findByRole("heading", { level: 1, name: "Agent not found" })).toBeInTheDocument();
  });

  it("still shows the page's error for a refused data source", async () => {
    mockApi(routes({ "GET /v1/teams/registrar/sources/s9": () => Reply.error(403, "forbidden", "You can't see this source.") }));
    renderApp("/teams/registrar/sources/s9");
    expect(await screen.findByText("Couldn't load this data source")).toBeInTheDocument();
    expect(screen.getByText(/You can't see this source/)).toBeInTheDocument();
  });

  it("still shows the page's not-found state for a missing knowledge base", async () => {
    mockApi(routes({ "GET /v1/teams/registrar/kbs/k1": () => Reply.error(404, "not_found", "Not found.") }));
    renderApp("/teams/registrar/kbs/k1");
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge base not found" })).toBeInTheDocument();
  });
});
