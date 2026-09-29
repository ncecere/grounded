/* The shell after the final UI pass: short-link breadcrumbs (M2), the admin gate for members (m4), page titles (D8) and not-found pages for unknown ids (P-05). */
import { screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { documentTitle } from "../components/layout/breadcrumbs";
import { Reply, mockApi, renderApp, shellRoutes } from "./harness";

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi!",
  starterQuestions: [],
  citationMode: "snippet_link",
  status: "active",
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("shell fixes", () => {
  it("names the agent in the breadcrumb of a short-link chat page (M2)", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents/short/registrar": () => card, "GET /v1/agents": () => [card] });
    renderApp("/a/registrar");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumbs).toHaveTextContent("Registrar assistant"));
    // Opened directly (not from Discover agents): a member sees the agent's team.
    await waitFor(() => expect(within(crumbs).getByRole("link", { name: "Office of the Registrar" })).toHaveAttribute("href", "/teams/registrar"));
    expect(crumbs).not.toHaveTextContent("Discover agents");
    expect(crumbs).not.toHaveTextContent("Page not found");
    await waitFor(() => expect(document.title).toBe("Registrar assistant · Office of the Registrar · Grounded"));
  });

  it("says Discover agents in a chat's breadcrumb only when the person came from there, and Chat for another team's agent", async () => {
    const other = { ...card, teamSlug: "campus", teamName: "Campus Services", slug: "guide", name: "Campus guide" };
    mockApi({ ...shellRoutes(), "GET /v1/agents/campus/guide": () => other, "GET /v1/agents": () => [other] });
    const { router } = renderApp("/");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await router.navigate({ to: "/a/$team/$agent", params: { team: "campus", agent: "guide" } });
    await waitFor(() => expect(crumbs).toHaveTextContent("Campus guide"));
    expect(crumbs).toHaveTextContent("Chat");
    expect(crumbs).not.toHaveTextContent("Discover agents");

    await router.navigate({ to: "/agents" });
    await router.navigate({ to: "/a/$team/$agent", params: { team: "campus", agent: "guide" } });
    await waitFor(() => expect(within(crumbs).getByRole("link", { name: "Discover agents" })).toHaveAttribute("href", "/agents"));
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("gives members the no-access page in the workspace shell at /admin, without admin requests (m4)", async () => {
    const calls = mockApi({ ...shellRoutes("none") });
    const { container } = renderApp("/admin");
    expect(await screen.findByRole("heading", { level: 1, name: "No access" })).toBeInTheDocument();
    expect(screen.getByText("The admin portal is for platform admins and auditors.")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Workspace sidebar" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent(/^Home\s*No access$/);
    expect(calls.filter((c) => c.url.startsWith("/v1/admin/"))).toEqual([]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says Page not found once in the breadcrumb of an unknown address", async () => {
    mockApi({ ...shellRoutes() });
    renderApp("/no/such/page");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumbs.textContent?.match(/Page not found/g)).toHaveLength(1));
  });

  it("shows the not-found page for an unknown agent id, not an inline error (P-05)", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/agents/bad-id": () => Reply.error(400, "invalid_id", "Invalid agentId"),
    });
    renderApp("/teams/registrar/agents/bad-id");
    expect(await screen.findByRole("heading", { level: 1, name: "Agent not found" })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this agent")).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumbs).toHaveTextContent(/Agents\s*Agent not found$/));
  });

  it("builds page titles from the last two crumbs and the instance name (D8)", () => {
    expect(documentTitle([{ label: "Office of the Registrar" }, { label: "Data sources" }], "Example RAG")).toBe(
      "Data sources · Office of the Registrar · Example RAG",
    );
    expect(documentTitle([{ label: "Home" }], "Example RAG")).toBe("Home · Example RAG");
    // A team still loading has no text crumb: the title never reads "… · Team · …".
    expect(documentTitle([{ label: <span>Team</span> }, { label: "Team settings" }], "Example RAG")).toBe("Team settings · Example RAG");
  });

  it("names the agent under each recent conversation in the sidebar, so the same titles can be told apart", async () => {
    const conv = (id: string, agentName: string, agentSlug: string) => ({
      id, agentId: "a-" + agentSlug, agentName, agentSlug, teamSlug: "registrar", agentDeleted: false,
      title: "How do I request a transcript?", createdAt: "2026-09-27T10:00:00Z", updatedAt: "2026-09-27T10:00:00Z",
    });
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [],
      "GET /v1/conversations": () => ({ items: [conv("c1", "Records helper", "records"), conv("c2", "Student help", "student")], nextCursor: null }),
    });
    renderApp("/teams/registrar/sources");
    const recent = await screen.findByRole("list", { name: "Recent conversations" });
    expect(within(recent).getByRole("link", { name: /^How do I request a transcript\?\W+Records helper$/ })).toHaveAttribute("href", "/a/registrar/records?c=c1");
    expect(within(recent).getByRole("link", { name: /^How do I request a transcript\?\W+Student help$/ })).toBeInTheDocument();
  });
});
