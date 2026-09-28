import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import { AddMemberDialog, MemberList } from "../components/members";
import { canManage } from "../components/roles";
import { SignInPage } from "../session";

function withQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

type Handler = (url: string, init?: RequestInit) => unknown;

/** Replaces fetch with canned {"data": ...} responses keyed by "METHOD path". */
function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body?: unknown; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;
    const text = await req.text();
    calls.push({ method: req.method, url: url.pathname, body: text ? JSON.parse(text) : undefined, headers: req.headers });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
    return new Response(JSON.stringify({ data: handler(url.pathname) }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const member = (id: string, name: string, role: "owner" | "admin" | "editor" | "member") => ({
  user: { id, email: `${id}@example.edu`, displayName: name, status: "active" },
  role,
  revision: 1,
  createdAt: "2026-09-25T10:00:00Z",
});

describe("member management rules", () => {
  it("mirrors the server: admins cannot touch owners", () => {
    expect(canManage("owner", "owner", "member")).toBe(true);
    expect(canManage("admin", "editor", "member")).toBe(true);
    expect(canManage("admin", "owner", "member")).toBe(false);
    expect(canManage("admin", "member", "owner")).toBe(false);
    expect(canManage("editor", "member", "member")).toBe(false);
    expect(canManage(undefined, "member")).toBe(false);
  });

  it("shows role controls only where the viewer may change them, and is accessible", async () => {
    mockApi({
      "GET /v1/teams/registrar/members": () => [member("o1", "Olive Owner", "owner"), member("m1", "Max Member", "member")],
    });
    const { container } = render(withQuery(<MemberList team="registrar" myRole="admin" myUserId="m9" />));
    await screen.findByText("Olive Owner");
    expect(screen.queryByRole("combobox", { name: "Role for Olive Owner" })).toBeNull();
    const maxRole = screen.getByRole("combobox", { name: "Role for Max Member" });
    expect([...(maxRole as HTMLSelectElement).options].map((o) => o.value)).toEqual(["admin", "editor", "member"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("puts Leave and Remove in the row menu, and gives the only owner no role select (W6)", async () => {
    mockApi({
      "GET /v1/teams/registrar/members": () => [member("o1", "Olive Owner", "owner"), member("m1", "Max Member", "member")],
    });
    const { container } = render(withQuery(<MemberList team="registrar" myRole="owner" myUserId="o1" />));
    await screen.findByText("Max Member");
    expect(screen.queryByRole("combobox", { name: "Role for Olive Owner" })).toBeNull();
    expect(screen.getByText("The only owner. Make someone else an owner to change this.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Max Member" })).toBeInTheDocument();
    // No search box for a small team.
    expect(screen.queryByRole("searchbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Olive Owner" }));
    const leave = await screen.findByRole("menuitem", { name: /Leave team/ });
    expect(leave).toHaveAttribute("aria-disabled", "true");
    expect(leave).toHaveTextContent("You're the only owner");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Actions for Max Member" }));
    expect(await screen.findByRole("menuitem", { name: "Remove from team…" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("adds a search box past 20 members", async () => {
    const many = Array.from({ length: 22 }, (_, i) => member(`p${i}`, `Person ${i}`, "member"));
    mockApi({ "GET /v1/teams/registrar/members": () => [member("o1", "Olive Owner", "owner"), ...many] });
    render(withQuery(<MemberList team="registrar" myRole="owner" myUserId="o1" />));
    const search = await screen.findByRole("searchbox", { name: "Search members" });
    await userEvent.type(search, "Person 17");
    await waitFor(() => expect(screen.queryByText("Person 3")).toBeNull());
    expect(screen.getByText("Person 17")).toBeInTheDocument();
  });

  it("sends the member's revision as If-Match when changing a role", async () => {
    const calls = mockApi({
      "GET /v1/teams/registrar/members": () => [member("m1", "Max Member", "member")],
      "PATCH /v1/teams/registrar/members/m1": () => member("m1", "Max Member", "editor"),
    });
    render(withQuery(<MemberList team="registrar" myRole="owner" myUserId="o1" />));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Role for Max Member" }), "editor");
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.headers.get("If-Match")).toBe('"1"');
    expect(patch.body).toEqual({ role: "editor" });
  });

  it("adds a member and reports an invite", async () => {
    const calls = mockApi({
      "POST /v1/teams/registrar/members": () => ({
        status: "invited",
        invite: { id: "i1", email: "new@example.edu", role: "editor", createdAt: "2026-09-25T10:00:00Z", expiresAt: "2026-10-25T10:00:00Z" },
      }),
    });
    render(withQuery(<AddMemberDialog team="registrar" myRole="admin" open onOpenChange={() => {}} />));
    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("option", { name: "Owner" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Email address"), "new@example.edu");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "editor");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText(/An invite was created for new@example.edu/)).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ email: "new@example.edu", role: "editor" });
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe("sign-in page", () => {
  it("lists development accounts and has no accessibility violations", async () => {
    mockApi({
      "GET /v1/auth/config": () => ({
        oidcEnabled: true,
        devAuthEnabled: true,
        loginUrl: "/auth/login",
        teamRequestUrl: null,
        devAccounts: [{ id: "admin", name: "Dev Platform Admin", email: "admin@localhost", platformRole: "platform_admin" }],
      }),
    });
    const { container } = render(withQuery(<SignInPage />));
    expect(await screen.findByRole("link", { name: /Sign in with single sign-on/ })).toHaveAttribute("href", expect.stringContaining("/auth/login?next="));
    expect(screen.getByRole("button", { name: /Dev Platform Admin/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
