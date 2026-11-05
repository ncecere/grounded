/* Admin → SCIM provisioning (docs/operations/scim.md): what to give the identity provider, a token shown once, revoking, and the
 * read-only view for auditors. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});

const token: Schemas["ScimToken"] = { id: "t1", name: "Okta", createdAt: "2026-11-01T10:00:00Z", lastUsedAt: null, createdBy: "Dev Platform Admin" };

const status = (extra: Partial<Schemas["ScimStatus"]> = {}): Schemas["ScimStatus"] => ({
  available: true,
  baseUrl: "https://grounded.example.edu/scim/v2",
  matchClaim: "sub",
  tokens: [token],
  users: 12,
  pendingUsers: 3,
  groups: 2,
  ...extra,
});

describe("Admin → SCIM provisioning", () => {
  it("shows what to give the identity provider, creates a token shown once, and revokes one", async () => {
    let current = status();
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/scim": () => current,
      "POST /v1/admin/scim/tokens": () => {
        const t = { ...token, id: "t2", name: "Entra ID" };
        current = { ...current, tokens: [...current.tokens, t] };
        return { token: t, secret: "scim_s3cret" };
      },
      "DELETE /v1/admin/scim/tokens/t1": () => ({ ok: true }),
    });
    const { container } = renderApp("/admin/scim");
    expect(await screen.findByText("https://grounded.example.edu/scim/v2")).toBeInTheDocument();
    expect(screen.getByText("12 managed by SCIM, 3 not signed in yet")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: "Tokens (1)" }));
    expect(within(await screen.findByRole("table", { name: "SCIM tokens" })).getByText("Okta")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    const create = await screen.findByRole("dialog", { name: "Create a SCIM token" });
    expect(within(create).getByRole("button", { name: "Create token" })).toBeDisabled();
    await userEvent.type(within(create).getByRole("textbox", { name: "Name" }), "Entra ID");
    await userEvent.click(within(create).getByRole("button", { name: "Create token" }));
    const secret = await screen.findByRole("dialog", { name: "SCIM token created" });
    expect(within(secret).getByText("Copy this token now.")).toBeInTheDocument();
    expect(within(secret).getByText("scim_s3cret")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Entra ID" });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(secret).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("scim_s3cret")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Actions for Okta" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revoke…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/admin/scim/tokens/t1")).toBe(true));
  });

  it("is read-only for auditors, and says SCIM needs a sign-in provider", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/scim": () => status({ available: false, tokens: [] }) });
    const { container } = renderApp("/admin/scim");
    expect(await screen.findByText("SCIM needs a sign-in provider")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Tokens (0)" }));
    expect(await screen.findByRole("table", { name: "SCIM tokens" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
