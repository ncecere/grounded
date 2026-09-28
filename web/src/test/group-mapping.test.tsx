/* SSO group mapping (E1): the admin page, a team's Group mapping tab with the dry run, and managed members in Team settings. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type Handler, mockApi, renderApp, shellRoutes, team } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const rule: Schemas["GroupRule"] = {
  id: "r1",
  group: "registrar-staff",
  team: { id: "t1", slug: "registrar", name: "Office of the Registrar" },
  teamStatus: "active",
  role: "editor",
  memberCount: 2,
  revision: 3,
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
};

const status: Schemas["GroupMappingStatus"] = {
  groupsClaim: "groups",
  oidcEnabled: true,
  ruleCount: 1,
  peopleSeen: 5,
  peopleWithClaim: 4,
  lastClaimAt: "2026-09-27T10:00:00Z",
  recentSignIns: 5,
  recentWithClaim: 4,
  groups: [{ name: "registrar-staff", people: 3 }],
};

const person = (id: string, name: string): Schemas["MemberUser"] => ({ id, email: `${id}@example.edu`, displayName: name, status: "active" });

const preview: Schemas["GroupRulePreview"] = {
  team: rule.team,
  changes: [
    { user: person("u5", "Pat Doe"), kind: "add", to: "editor", groupsSeenAt: "2026-09-27T10:00:00Z" },
    { user: person("u6", "Riley Roe"), kind: "manual", from: "member", to: "editor", groupsSeenAt: "2026-09-26T10:00:00Z" },
  ],
};

const summary: Schemas["TeamSummary"] = { team: team as Schemas["Team"], memberCount: 3, ownerCount: 1, agentCount: 0, sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0 };

function routes(role: "platform_admin" | "platform_auditor" = "platform_admin", extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...shellRoutes(role),
    "GET /v1/admin/group-mapping": () => status,
    "GET /v1/admin/group-mapping/rules": () => [rule],
    "POST /v1/admin/group-mapping/preview": () => preview,
    "GET /v1/admin/teams/registrar": () => summary,
    "GET /v1/admin/teams": () => ({ items: [summary], nextCursor: null }),
    ...extra,
  };
}

describe("Admin → Group mapping", () => {
  it("lists the rules with what sign-ins carry (auditors read only)", async () => {
    mockApi(routes("platform_auditor"));
    const { container } = renderApp("/admin/group-mapping");
    const table = await screen.findByRole("table", { name: "Group mapping rules" });
    const row = (await within(table).findByText("registrar-staff")).closest("tr")!;
    expect(row).toHaveTextContent("Office of the Registrar");
    expect(row).toHaveTextContent("Editor");
    expect(await screen.findByText(/People whose last sign-in carried it: 4 of 5/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add rule/ })).toBeNull();
    expect(screen.getByText("You can view the rules. Only platform admins can add, change or delete them.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("warns when rules exist but no recent sign-in carried the claim", async () => {
    mockApi(routes("platform_admin", { "GET /v1/admin/group-mapping": () => ({ ...status, recentWithClaim: 0 }) }));
    renderApp("/admin/group-mapping");
    expect(await screen.findByText(/No recent sign-in carried the/)).toBeInTheDocument();
  });

  it("deletes a rule after showing its dry run", async () => {
    const calls = mockApi(routes("platform_admin", { "DELETE /v1/admin/group-mapping/rules/r1": () => ({ ok: true }) }));
    renderApp("/admin/group-mapping");
    await screen.findByRole("table", { name: "Group mapping rules" });
    await userEvent.click(await screen.findByRole("button", { name: /Actions for registrar-staff/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete rule…" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Delete the rule for registrar-staff/ });
    expect(await within(dialog).findByText("Pat Doe")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 memberships in Office of the Registrar came from this rule. Deleting it removes those people from the team now;");
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/admin/group-mapping/preview")?.body).toEqual({ ruleId: "r1", delete: true }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/admin/group-mapping/rules/r1")).toBe(true));
  });
});

describe("a team's Group mapping tab", () => {
  it("adds a rule for the team after a dry run", async () => {
    const calls = mockApi(routes("platform_admin", { "POST /v1/admin/group-mapping/rules": (body) => ({ ...rule, ...(body as object), team: rule.team }) }));
    const { container } = renderApp("/admin/teams/registrar?tab=group-mapping");
    await screen.findByRole("table", { name: "Group mapping rules for Office of the Registrar" });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getAllByRole("button", { name: /Add rule/ })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add group mapping rule" });
    await userEvent.type(within(dialog).getByRole("combobox", { name: /IdP group/ }), "Registrar-Helpers");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Role" }), "editor");
    expect(await within(dialog).findByText(/1 added/)).toBeInTheDocument();
    expect(within(dialog).getByText("Left alone: added by hand")).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "Groups last seen" })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((c) => c.url === "/v1/admin/group-mapping/preview").at(-1)?.body).toEqual({ group: "Registrar-Helpers", team: "registrar", role: "editor", delete: false }),
    );
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/v1/admin/group-mapping/rules")?.body).toEqual({ group: "Registrar-Helpers", team: "registrar", role: "editor" }));
  });

  it("says once, under the group, that the team already has a rule for it (no failed dry run)", async () => {
    const calls = mockApi(routes());
    renderApp("/admin/teams/registrar?tab=group-mapping");
    await screen.findByRole("table", { name: "Group mapping rules for Office of the Registrar" });
    await userEvent.click(screen.getAllByRole("button", { name: /Add rule/ })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add group mapping rule" });
    await userEvent.type(within(dialog).getByRole("combobox", { name: /IdP group/ }), "Registrar-Staff");
    expect(await within(dialog).findAllByText("This team already has a rule for that group. Change that rule instead.")).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    expect(within(dialog).getAllByText(/already has a rule/)).toHaveLength(1);
    expect(within(dialog).queryByText("Couldn't run the dry run")).toBeNull();
    expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/group-mapping/rules")).toBe(false);
  });

  it("asks for a group before saving", async () => {
    const calls = mockApi(routes());
    renderApp("/admin/teams/registrar?tab=group-mapping");
    await screen.findByRole("table", { name: "Group mapping rules for Office of the Registrar" });
    await userEvent.click(screen.getAllByRole("button", { name: /Add rule/ })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add group mapping rule" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    expect(await within(dialog).findByText(/Enter the group's name/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/group-mapping/rules")).toBe(false);
  });
});

describe("managed members in Team settings", () => {
  const member = (id: string, name: string, role: Schemas["TeamRole"], managedBy?: Schemas["MemberManagedBy"]): Schemas["Member"] => ({
    user: person(id, name),
    role,
    revision: 1,
    createdAt: "2026-09-25T10:00:00Z",
    managedBy,
  });

  it("says who a rule manages and explains why they can't be removed by hand", async () => {
    mockApi({
      ...shellRoutes("none", "owner"),
      "GET /v1/teams/registrar/members": () => [
        { ...member("u1", "Una User", "owner"), user: { id: "u1", email: "una@example.edu", displayName: "Una User", status: "active" } },
        member("u5", "Pat Doe", "editor", { ruleId: "r1", group: "registrar-staff" }),
        member("u7", "Blair Dev", "member"),
      ],
      "GET /v1/teams/registrar/invites": () => [],
    });
    const { container } = renderApp("/teams/registrar/settings");
    const table = await screen.findByRole("table", { name: "Team members" });
    const pat = (await within(table).findByText("Pat Doe")).closest("tr")!;
    expect(within(pat).getByText("Managed by SSO group registrar-staff")).toBeInTheDocument();
    expect(within(pat).queryByRole("combobox")).toBeNull();
    expect(within(table).getByRole("combobox", { name: "Role for Blair Dev" })).toBeInTheDocument();
    await userEvent.click(within(pat).getByRole("button", { name: /Actions for Pat Doe/ }));
    const remove = await screen.findByRole("menuitem", { name: /Remove from team/ });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(await axe(container)).toHaveNoViolations();
  });
});
