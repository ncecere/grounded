/* The instance identity (ADR-0018): names, theme, logo and help link come from GET /v1/auth/config. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import { applyInstance, defaultInstance, instanceOf, tagline, type Instance } from "../lib/instance";
import { routeTree } from "../router";
import { SignInPage } from "../session";

const campus: Instance = {
  name: "Campus Assistant",
  orgName: "Example University",
  theme: "neutral",
  logoUrl: "/brand/logo.svg",
  supportUrl: "https://help.example.edu/ai",
};

const authConfig = (instance?: Instance, oidcEnabled = true) => ({
  oidcEnabled,
  devAuthEnabled: false,
  loginUrl: "/auth/login",
  teamRequestUrl: null,
  devAccounts: [],
  ...(instance ? { instance } : {}),
});

function mockApi(routes: Record<string, () => unknown>) {
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    return json(200, { data: handler() });
  });
}

function withQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function renderApp(path = "/") {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(withQuery(<RouterProvider router={router} />));
}

const me = {
  user: { id: "u1", email: "una@example.edu", displayName: "Una User", platformRole: "none", status: "active" },
  teams: [],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: false, platformAuditor: false },
};

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.dataset.brand = "neutral";
  document.title = "";
});

describe("instance helpers", () => {
  it("fills in defaults and builds the tagline", () => {
    expect(instanceOf(undefined)).toEqual(defaultInstance);
    expect(instanceOf({ instance: { name: "  ", orgName: "", theme: "neutral", logoUrl: "", supportUrl: null } })).toEqual(defaultInstance);
    expect(tagline(defaultInstance)).toBe("Knowledge bases and AI agents for your teams");
    expect(tagline(campus)).toBe("Knowledge bases and AI agents for Example University teams");
  });

  it("applies the theme and title to the document", () => {
    delete document.documentElement.dataset.brand;
    applyInstance(campus);
    expect(document.documentElement).toHaveAttribute("data-brand", "neutral");
    expect(document.title).toBe("Campus Assistant");
    // A page title the shell set ("Page \u00b7 Instance") is kept.
    document.title = "Home \u00b7 Campus Assistant";
    applyInstance(campus);
    expect(document.title).toBe("Home \u00b7 Campus Assistant");
  });
});

describe("sign-in page", () => {
  it("is neutral by default: product name, no organisation, the default mark and no help link", async () => {
    mockApi({ "GET /v1/auth/config": () => authConfig(defaultInstance) });
    const { container } = render(withQuery(<SignInPage />));
    expect(await screen.findByText("Use your organization account to continue.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Grounded" })).toBeInTheDocument();
    expect(screen.getByText("Knowledge bases and AI agents for your teams")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in with single sign-on/ })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: /Help/ })).toBeNull();
    expect(container.textContent).not.toMatch(/University|Example/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("uses the configured names, logo and help link", async () => {
    mockApi({ "GET /v1/auth/config": () => authConfig(campus) });
    const { container } = render(withQuery(<SignInPage />));
    expect(await screen.findByRole("heading", { level: 1, name: "Campus Assistant" })).toBeInTheDocument();
    expect(screen.getByText("Knowledge bases and AI agents for Example University teams")).toBeInTheDocument();
    expect(screen.getByText("Use your Example University account to continue.")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/logo.svg");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.getByRole("link", { name: /Help signing in/ })).toHaveAttribute("href", "https://help.example.edu/ai");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("works with a server that sends no instance", async () => {
    mockApi({ "GET /v1/auth/config": () => authConfig(undefined, false) });
    render(withQuery(<SignInPage />));
    expect(await screen.findByText("No sign-in method is configured.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Grounded" })).toBeInTheDocument();
  });
});

describe("app shell", () => {
  it("shows the instance name and logo, applies the theme and offers Help in the user menu", async () => {
    const user = userEvent.setup();
    delete document.documentElement.dataset.brand;
    mockApi({ "GET /v1/auth/config": () => authConfig(campus), "GET /v1/me": () => me, "GET /v1/agents": () => [], "GET /v1/conversations": () => ({ items: [], nextCursor: null }) });
    const { container } = renderApp("/");
    const brand = await screen.findByRole("link", { name: "Campus Assistant" });
    expect(brand.querySelector("img")).toHaveAttribute("src", "/brand/logo.svg");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-brand", "neutral"));
    await waitFor(() => expect(document.title).toBe("Home · Campus Assistant"));

    await user.click(screen.getByRole("button", { name: /Account:\s*Una User/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Help" })).toHaveAttribute("href", "https://help.example.edu/ai");
    await user.keyboard("{Escape}");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no Help link without SUPPORT_URL, and the not-found page offers Help with it", async () => {
    const user = userEvent.setup();
    mockApi({ "GET /v1/auth/config": () => authConfig(defaultInstance), "GET /v1/me": () => me, "GET /v1/agents": () => [], "GET /v1/conversations": () => ({ items: [], nextCursor: null }) });
    const { unmount } = renderApp("/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grounded" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Help" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Account:\s*Una User/ }));
    expect(within(await screen.findByRole("menu")).queryByRole("menuitem", { name: "Help" })).toBeNull();
    unmount();

    mockApi({ "GET /v1/auth/config": () => authConfig(campus), "GET /v1/me": () => me, "GET /v1/agents": () => [], "GET /v1/conversations": () => ({ items: [], nextCursor: null }) });
    renderApp("/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Help" })).toHaveAttribute("href", "https://help.example.edu/ai");
  });
});
