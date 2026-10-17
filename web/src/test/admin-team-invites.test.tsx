/* #144: "Open invites" on an admin team's Members tab shows the address "Assign owner" has just invited. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const invite = (id: string, email: string) => ({ id, email, role: "owner", createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-31T10:00:00Z" });

describe("admin team members: Assign owner", () => {
  it("shows a newly invited owner under Open invites at once", async () => {
    const invites = [invite("i1", "old.owner@example.edu")];
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams/registrar": () => ({
        team: { id: "t1", slug: "registrar", name: "Office of the Registrar", description: "", maxClassification: "sensitive", status: "active", revision: 1, createdAt: "", updatedAt: "" },
        memberCount: 0, ownerCount: 0, ownerInvites: 1, agentCount: 0, sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0,
      }),
      "GET /v1/admin/users": () => ({ items: [], nextCursor: null }),
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => invites,
      "POST /v1/admin/teams/registrar/owners": (body) => {
        invites.push(invite("i2", (body as { email: string }).email));
        return { ok: true };
      },
    });
    renderApp("/admin/teams/registrar?tab=members");
    const open = (await screen.findByRole("heading", { name: "Open invites" }, { timeout: scaled(4000) })).closest("section")!;
    expect(within(open).getByText("old.owner@example.edu")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Assign owner/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("combobox", { name: /Person/ }), "new.owner@example.edu");
    await userEvent.click(await screen.findByRole("option", { name: /Invite new\.owner@example\.edu/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign owner" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/teams/registrar/owners")).toBe(true));
    expect(await within(open).findByText("new.owner@example.edu", {}, { timeout: scaled(4000) })).toBeInTheDocument();
    expect(within(open).getByText("old.owner@example.edu")).toBeInTheDocument();
  });
});
