/* Cross-cutting fixes: confirmations (Q2/F-03, F-23, P-12), self-suspend (P-04) and field messages (F-05). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const person = (id: string, displayName: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.edu`,
  displayName,
  platformRole: "none",
  status: "active",
  revision: 3,
  createdAt: "2026-09-01T10:00:00Z",
  lastLoginAt: null,
  ...over,
});

const adminRoutes = { ...shellRoutes("platform_admin"), "GET /v1/admin/models": () => [] };

describe("platform role (Q2, F-03)", () => {
  it("asks before granting a platform role, naming what it can do", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...adminRoutes,
      "GET /v1/admin/users/u2": () => ({ user: person("u2", "Dev User"), teams: [] }),
      "PATCH /v1/admin/users/u2": (body) => person("u2", "Dev User", body as Record<string, unknown>),
    });
    renderApp("/admin/users/u2");
    const select = await screen.findByRole("combobox", { name: /Platform role/ });
    await user.selectOptions(select, "platform_admin");
    const dialog = await screen.findByRole("alertdialog", { name: "Make Dev User a platform admin?" });
    expect(dialog).toHaveTextContent(/turn any agent off/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Make platform admin" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ platformRole: "platform_admin" }));
  });

  it("doesn't let an admin suspend themselves (P-04)", async () => {
    mockApi({ ...adminRoutes, "GET /v1/admin/users/u1": () => ({ user: person("u1", "Una User", { platformRole: "platform_admin" }), teams: [] }) });
    renderApp("/admin/users/u1");
    // Suspend is a menu action (Q12), disabled with the reason.
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
    const item = await screen.findByRole("menuitem", { name: /Suspend/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("You can't suspend yourself");
    expect(screen.getByText(/This is you/)).toBeInTheDocument();
  });
});

describe("public access switch (F-23)", () => {
  it("names the public agents before turning public access off", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...adminRoutes,
      "GET /v1/admin/settings/public-access": () => ({
        publicAgentsEnabled: true,
        revision: 1,
        updatedAt: null,
        captcha: { provider: "none", siteKey: "" },
        anonSessionTtlSeconds: 3600,
      }),
      "GET /v1/admin/limits": () => ({ items: [], revision: 1, updatedAt: null }),
      "GET /v1/admin/agents": () => [
        { id: "a1", name: "Registrar assistant", teamName: "Office of the Registrar", audience: "public", publishedVersion: 3, status: "active" },
        { id: "a2", name: "Internal helper", teamName: "Office of the Registrar", audience: "team", publishedVersion: 1, status: "active" },
      ],
      "PUT /v1/admin/settings/public-access": (body) => ({ ...(body as object), revision: 2, updatedAt: null, captcha: { provider: "none", siteKey: "" }, anonSessionTtlSeconds: 3600 }),
    });
    const { baseElement } = renderApp("/admin/public-access");
    await user.click(await screen.findByRole("switch", { name: /Allow public agents/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Turn off public agents?" });
    expect(await within(dialog).findByText("Registrar assistant")).toBeInTheDocument();
    expect(within(dialog).queryByText("Internal helper")).toBeNull();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.click(within(dialog).getByRole("button", { name: "Turn off public agents" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ publicAgentsEnabled: false }));
  });
});

describe("detaching a source (P-12)", () => {
  const kb = {
    id: "k1",
    name: "Student handbook",
    description: "",
    embeddingProfileId: "p1",
    topK: 8,
    sources: [{ id: "s1", name: "Policies", classification: "sensitive", shared: false }],
    effectiveClassification: "sensitive",
    revision: 2,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
  };

  it("asks first when a live agent answers from the knowledge base", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/kbs/k1": () => kb,
      "GET /v1/teams/registrar/kbs": () => [kb],
      "GET /v1/teams/registrar/sources": () => [],
      "GET /v1/shared-sources": () => [],
      "GET /v1/teams/registrar/agents": () => [
        { id: "a1", name: "Registrar assistant", status: "active", published: { knowledgeBases: [{ id: "k1", name: "Student handbook", topK: 8 }] } },
      ],
      "DELETE /v1/teams/registrar/kbs/k1/sources/s1": () => ({ ...kb, sources: [] }),
    });
    renderApp("/teams/registrar/kbs/k1?tab=sources");
    await user.click(await screen.findByRole("button", { name: "Actions for Policies" }));
    await user.click(await screen.findByRole("menuitem", { name: "Detach" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Detach Policies?" });
    expect(dialog).toHaveTextContent("Registrar assistant answers from Student handbook");
    await user.click(within(dialog).getByRole("button", { name: "Detach source" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("field messages (F-05)", () => {
  it("says what's wrong with the add-member email, not just a red border", async () => {
    const user = userEvent.setup();
    mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => [],
    });
    renderApp("/teams/registrar/settings");
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a member" });
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));
    expect(await within(dialog).findByText("Enter an email address.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Email address/ }), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));
    expect(await within(dialog).findByText("Enter an email address like name@example.org.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Email address/ })).toHaveAttribute("aria-invalid", "true");
  });

  it("explains an empty or badly formed create-team form", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ ...adminRoutes, "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }) });
    renderApp("/admin/teams");
    await user.click(await screen.findByRole("button", { name: /Create team/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create team" });
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));
    expect(await within(dialog).findByText("Enter the team's name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter an email address.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Slug" }), "Bad Slug");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));
    expect(await within(dialog).findByText(/Use lowercase letters, digits and hyphens/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows a taken slug on the Slug field (P-17)", async () => {
    const user = userEvent.setup();
    mockApi({
      ...adminRoutes,
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "POST /v1/admin/teams": () => Reply.error(409, "slug_taken", "A team with that slug already exists"),
    });
    renderApp("/admin/teams");
    await user.click(await screen.findByRole("button", { name: /Create team/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create team" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Registrar");
    await user.type(within(dialog).getByRole("textbox", { name: /Owner's email/ }), "owner@example.edu");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));
    const slug = within(dialog).getByRole("textbox", { name: "Slug" });
    expect(await within(dialog).findByText("A team with this slug already exists. Choose another.")).toBeInTheDocument();
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await user.type(slug, "-2");
    await waitFor(() => expect(within(dialog).queryByText("A team with this slug already exists. Choose another.")).toBeNull());
  });
});
