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
    expect(crumbs).toHaveTextContent("Discover agents");
    expect(crumbs).not.toHaveTextContent("Page not found");
    await waitFor(() => expect(document.title).toBe("Registrar assistant · Discover agents · Grounded"));
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
});
