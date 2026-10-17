/*
 * #132: the email fields accept every address the server does (teams.NormalizeEmail: Go's mail.ParseAddress),
 * including name@localhost, and no more. The accepted and refused lists below were produced by running that
 * function on each address.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emailProblem } from "../lib/validation";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const accepted = [
  "name@localhost",
  "a@b",
  "a@b.c",
  "name@example.org",
  "a+tag@example.edu",
  "o'brien@example.edu",
  "a=b@x.org",
  "a!b#c$d%e&f'g*h+i-j/k=l?m^n_o`p{q|r}s~t@x.org",
  "a@[127.0.0.1]",
  "a@[::1]",
  "josé@example.edu",
  "用户@例え.jp",
  "  padded@x.org  ",
  "a@x_y.org",
  "a@-x.org",
  `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`, // 254 bytes
];
const refused = [
  "name",
  "name@",
  "@localhost",
  "a b@x.org",
  "a@b c",
  "a..b@x.org",
  ".a@x.org",
  "a.@x.org",
  "a@.x.org",
  "a@x..org",
  "a@x.org.",
  "a@localhost.",
  'a"b@x.org',
  '"a b"@x.org',
  "Name <a@x.org>",
  "a@x.org, b@y.org",
  "a,b@x.org",
  "a(b)@x.org",
  "a<b>@x.org",
  "a;b@x.org",
  "a:b@x.org",
  "a\\b@x.org",
  "a[b]@x.org",
  "a@b@c",
  "a@[1.2.3]",
  "a@[bad]",
  `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`, // 255 bytes
];

describe("emailProblem", () => {
  it.each(accepted)("accepts %s", (email) => expect(emailProblem(email)).toBeUndefined());
  it.each(refused)("refuses %s", (email) => expect(emailProblem(email)).toBe("Enter an email address like name@example.org."));
  it("asks for an address when the field is empty", () => expect(emailProblem("  ")).toBe("Enter an email address."));
});

describe("email fields in the forms", () => {
  it("Create team takes an owner at localhost", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "POST /v1/admin/teams": () => ({
        team: { team: { id: "t9", slug: "demo", name: "Demo", description: "", maxClassification: "open", status: "active", revision: 1, createdAt: "", updatedAt: "" }, memberCount: 1, ownerCount: 1, ownerInvites: 0, agentCount: 0, sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0 },
        owner: { status: "invited", invite: { id: "i1", email: "admin@localhost", role: "owner", createdAt: "", expiresAt: "" } },
      }),
    });
    renderApp("/admin/teams");
    await user.click(await screen.findByRole("button", { name: /Create team/ }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog", { name: "Create team" });
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Demo");
    await user.type(within(dialog).getByRole("textbox", { name: /Owner's email/ }), "admin@localhost");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));
    expect(await within(dialog).findByText(/was invited as owner/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Enter an email address like name@example.org.")).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ ownerEmail: "admin@localhost" });
  });

  it("Add member takes an address at localhost", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => [],
      "POST /v1/teams/registrar/members": () => ({ status: "invited", invite: { id: "i1", email: "alex@localhost", role: "member", createdAt: "", expiresAt: "" } }),
    });
    renderApp("/teams/registrar/settings");
    await user.click(await screen.findByRole("button", { name: "Add member" }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog", { name: "Add member" });
    await user.type(within(dialog).getByRole("textbox", { name: /Email address/ }), "alex@localhost");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));
    expect(await within(dialog).findByText(/An invite was created for alex@localhost/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.url === "/v1/teams/registrar/members")?.body).toEqual({ email: "alex@localhost", role: "member" });
  });

  it("Assign owner offers to invite an address at localhost", async () => {
    const user = userEvent.setup();
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams/registrar": () => ({
        team: { id: "t1", slug: "registrar", name: "Office of the Registrar", description: "", maxClassification: "sensitive", status: "active", revision: 1, createdAt: "", updatedAt: "" },
        memberCount: 0, ownerCount: 0, ownerInvites: 0, agentCount: 0, sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0,
      }),
      "GET /v1/admin/users": () => ({ items: [], nextCursor: null }),
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => [],
    });
    renderApp("/admin/teams/registrar?tab=members");
    await user.click(await screen.findByRole("button", { name: /Assign owner/ }, { timeout: scaled(4000) }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox", { name: /Person/ }), "new@localhost");
    expect(await screen.findByRole("option", { name: /Invite new@localhost/ })).toBeInTheDocument();
  });
});
