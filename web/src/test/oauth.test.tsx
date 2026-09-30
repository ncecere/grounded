/* OAuth sign-in for MCP clients (docs/mcp.md): the consent page, and Connected apps on the API keys page and a person's admin page. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { redirectTo } from "../pages/oauth/consent";
import { type Handler, meFor, mockApi, renderApp, Reply, shellRoutes } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const query =
  "client_id=gcl_abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcallback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&resource=https%3A%2F%2Frag.example.edu%2Fmcp&state=st-1";

const consent = (kind: "metadata" | "registered"): Schemas["OAuthConsent"] => ({
  client: {
    id: kind === "metadata" ? "https://assistant.example.com/client.json" : "gcl_abc",
    kind,
    name: "Research Assistant",
    host: "assistant.example.com",
    uri: null,
    logoUrl: null,
  },
  redirectUri: "http://127.0.0.1:4567/callback",
  redirectHost: "127.0.0.1:4567",
  remembered: false,
});

function openConsent(routes: Record<string, Handler>) {
  window.history.replaceState({}, "", `/oauth/consent?${query}`);
  const calls = mockApi({ ...shellRoutes(), ...routes });
  return { calls, ...renderApp(`/oauth/consent?${query}`) };
}

describe("OAuth consent page", () => {
  it("names the client and its host, says what it may do, and allows with the app's CSRF token", async () => {
    const go = vi.spyOn(redirectTo, "go").mockImplementation(() => {});
    const { calls, container } = openConsent({
      "GET /v1/oauth/consent": () => consent("metadata"),
      "POST /v1/oauth/consent": () => ({ redirectUrl: "http://127.0.0.1:4567/callback?code=gac_x&state=st-1&iss=https%3A%2F%2Frag.example.edu" }),
    });
    expect(await screen.findByRole("heading", { level: 1, name: /Research Assistant wants to use .+ as you/ })).toBeInTheDocument();
    expect(screen.getByText("assistant.example.com")).toBeInTheDocument();
    expect(screen.getByText("Search knowledge bases and ask agents in Office of the Registrar, as you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connected apps" })).toHaveAttribute("href", "/settings/connected-apps");
    await waitFor(() => expect(document.title).toMatch(/^Connect Research Assistant · /));
    expect(screen.getByText("127.0.0.1:4567")).toBeInTheDocument();
    expect(screen.getByText("una@example.edu")).toBeInTheDocument();
    expect(screen.queryByText("Unverified")).toBeNull();
    // The request's parameters are read as the endpoint passed them on.
    const get = calls.find((c) => c.method === "GET" && c.url === "/v1/oauth/consent")!;
    expect(get.search.get("client_id")).toBe("gcl_abc");
    expect(get.search.get("resource")).toBe("https://rag.example.edu/mcp");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(expect.stringContaining("code=gac_x")));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ query, decision: "allow" });
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-123");
  });

  it("marks a registered client unverified, and denies", async () => {
    const go = vi.spyOn(redirectTo, "go").mockImplementation(() => {});
    const { calls, container } = openConsent({
      "GET /v1/oauth/consent": () => consent("registered"),
      "POST /v1/oauth/consent": () => ({ redirectUrl: "http://127.0.0.1:4567/callback?error=access_denied" }),
    });
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
    // A registered client's website is its own claim, and the warning names where the answer really goes.
    expect(screen.getByText(/Says it's from assistant.example.com/)).toBeInTheDocument();
    expect(screen.queryByText("assistant.example.com", { selector: "strong" })).toBeNull();
    const warning = screen.getByText(/registered itself, so its name and website aren't checked/);
    expect(warning).toHaveTextContent("Your answer goes to 127.0.0.1:4567.");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("http://127.0.0.1:4567/callback?error=access_denied"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ query, decision: "deny" });
  });

  it("shows a request that isn't valid, with nothing to allow and no redirect", async () => {
    const go = vi.spyOn(redirectTo, "go").mockImplementation(() => {});
    const { container } = openConsent({
      "GET /v1/oauth/consent": () => Reply.error(400, "oauth_invalid_request", "The redirect_uri isn't one the client registered."),
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Can't connect this app" })).toBeInTheDocument();
    expect(await screen.findByText("The redirect_uri isn't one the client registered.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(go).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toMatch(/^Can't connect this app · /));
    expect(await axe(container)).toHaveNoViolations();
  });
});

const grant: Schemas["OAuthGrant"] = {
  id: "g1",
  clientId: "gcl_abc",
  clientKind: "registered",
  clientName: "Research Assistant",
  clientHost: "assistant.example.com",
  createdAt: "2026-09-29T10:00:00Z",
  lastUsedAt: null,
};

const keysRoutes = (me: unknown, grants: () => unknown): Record<string, Handler> => ({
  ...shellRoutes("none", "member"),
  "GET /v1/me": () => me,
  "GET /v1/teams/registrar/api-keys": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/agents": () => [],
  "GET /v1/teams/registrar/members": () => [],
  "GET /v1/me/oauth-grants": grants,
});

describe("Connected apps", () => {
  it("lists the person's apps on their API keys page and disconnects one", async () => {
    let list = [grant];
    const calls = mockApi({
      ...keysRoutes({ ...meFor("none", "member"), capabilities: { platformAdmin: false, platformAuditor: false, mcpOAuth: true } }, () => list),
      "DELETE /v1/me/oauth-grants/g1": () => {
        list = [];
        return { ok: true };
      },
    });
    const { container } = renderApp("/teams/registrar/settings?tab=api-keys");
    const card = (await screen.findByRole("heading", { name: "Connected apps" })).closest("section")!;
    const table = await within(card).findByRole("list", { name: "Your connected apps" });
    expect(within(table).getByText("Research Assistant")).toBeInTheDocument();
    expect(within(table).getByText("assistant.example.com")).toBeInTheDocument();
    expect(within(table).getByText("Unverified")).toBeInTheDocument();
    expect(within(table).getByText("Not used yet")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(table).getByRole("button", { name: "Disconnect Research Assistant…" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Disconnect Research Assistant?" });
    expect(await axe(confirm)).toHaveNoViolations();
    await userEvent.click(within(confirm).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/me/oauth-grants/g1")).toBe(true));
    expect(await within(card).findByText("No connected apps.")).toBeInTheDocument();
  });

  it("is left out while OAuth sign-in is off and nothing is connected", async () => {
    const calls = mockApi(keysRoutes(meFor("none", "member"), () => []));
    renderApp("/teams/registrar/settings?tab=api-keys");
    expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/me/oauth-grants")).toBe(true));
    expect(screen.queryByRole("heading", { name: "Connected apps" })).toBeNull();
  });

  it("shows a person's apps on their admin page: platform admins disconnect, auditors only read", async () => {
    const person = {
      user: { id: "u2", email: "u2@example.edu", displayName: "Pat Person", platformRole: "none", status: "active", revision: 1, createdAt: "", lastLoginAt: null, teamCount: 0 },
      teams: [],
    };
    for (const role of ["platform_admin", "platform_auditor"] as const) {
      const calls = mockApi({
        ...shellRoutes(role),
        "GET /v1/admin/users/u2": () => person,
        "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }),
        "GET /v1/admin/users/u2/oauth-grants": () => [grant],
        "DELETE /v1/admin/users/u2/oauth-grants/g1": () => ({ ok: true }),
      });
      const { container, unmount } = renderApp("/admin/users/u2");
      const card = (await screen.findByRole("heading", { name: "Connected apps" })).closest("section")!;
      expect(await within(card).findByText("Research Assistant")).toBeInTheDocument();
      expect(card).toHaveTextContent("AI tools Pat Person allowed");
      // A record page: the exact date, not "3 days ago".
      expect(card.querySelector("time")?.textContent).toMatch(/2026/);
      const button = within(card).queryByRole("button", { name: "Disconnect Research Assistant…" });
      if (role === "platform_auditor") {
        expect(button).toBeNull();
        expect(card).not.toHaveTextContent("Disconnecting one stops it at once.");
        expect(within(card).queryByRole("columnheader")).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      } else {
        expect(await axe(container)).toHaveNoViolations();
        await userEvent.click(button!);
        await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/admin/users/u2/oauth-grants/g1")).toBe(true));
      }
      unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe("Connected apps from the account menu", () => {
  it("is reachable by a person in no team, and in the account menu", async () => {
    const me = { ...meFor("platform_auditor"), teams: [] };
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/me": () => me, "GET /v1/me/oauth-grants": () => [grant] });
    const { container } = renderApp("/settings/connected-apps");
    expect(await screen.findByRole("heading", { level: 1, name: "Connected apps" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Disconnect Research Assistant…" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is linked from the account menu", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [] });
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: /Una User/ }));
    expect(await screen.findByRole("menuitem", { name: "Connected apps" })).toHaveAttribute("href", "/settings/connected-apps");
  });

  it("an empty list reads with correct grammar, and the person's page dates sign-ins exactly", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/users/u2": () => ({
      user: { id: "u2", email: "u2@example.edu", displayName: "Sam Ortiz", platformRole: "none", status: "active", revision: 1, createdAt: "2026-09-01T10:00:00Z", lastLoginAt: new Date().toISOString(), teamCount: 0 },
      teams: [],
    }), "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }), "GET /v1/admin/users/u2/oauth-grants": () => [] });
    renderApp("/admin/users/u2");
    expect(await screen.findByText("Apps Sam Ortiz connects with OAuth sign-in are listed here.")).toBeInTheDocument();
    // A record page: absolute dates, not "3 seconds ago".
    const first = screen.getByText("First signed in").parentElement!;
    expect(first).toHaveTextContent(/Sep 1, 2026/);
    expect(screen.getByText("Last sign-in").parentElement!).not.toHaveTextContent(/ago|now/);
  });

  it("tells a person in no team that the app reaches nothing yet", async () => {
    window.history.replaceState({}, "", `/oauth/consent?${query}`);
    mockApi({ ...shellRoutes(), "GET /v1/me": () => ({ ...meFor(), teams: [] }), "GET /v1/oauth/consent": () => consent("metadata") });
    renderApp(`/oauth/consent?${query}`);
    expect(await screen.findByText("You're not in any team yet, so it can't reach anything until you join one.")).toBeInTheDocument();
  });
});
