/* Admin → Agents (Q3): the list that fits, the always-visible kill switch, the agent record page with the short name. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { adminAgent } from "./admin-fixtures";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const adminRoutes = (role: "platform_admin" | "platform_auditor", extra: Record<string, Handler> = {}) => ({
  ...shellRoutes(role),
  "GET /v1/admin/agents": () => [
    adminAgent(),
    adminAgent("disabled_by_platform", { id: "ag2", name: "Advising bot", slug: "advising-bot", teamSlug: "advising", teamName: "Advising", audience: "public", shortName: "advise" }),
  ],
  ...extra,
});

describe("admin agents", () => {
  it("lists agents with platform-disabled ones first and disables one with a reason", async () => {
    const calls = mockApi(adminRoutes("platform_admin", { "POST /v1/admin/agents/ag1/status": () => adminAgent("disabled_by_platform") }));
    const { container } = renderApp("/admin/agents");
    const table = await screen.findByRole("table", { name: "Agents" });
    await within(table).findByText("Advising bot");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Advising bot");
    expect(rows[1]).toHaveTextContent("/a/advise");
    // Version, Model and Updated are hidden by default so the table fits.
    expect(within(table).queryByRole("columnheader", { name: /Version/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("button", { name: "Disable Registrar assistant" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Disable agent" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Under review");
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/admin/agents/ag1/status")?.body).toEqual({ status: "disabled_by_platform", reason: "Under review" }));
  });

  it("filters by audience in the URL and edits the short name on the record page", async () => {
    const calls = mockApi(adminRoutes("platform_admin", { "PUT /v1/admin/agents/ag1/short-name": () => adminAgent("active", { shortName: "reg" }) }));
    const { router } = renderApp("/admin/agents?audience=team");
    const table = await screen.findByRole("table", { name: "Agents" });
    await within(table).findByText("Registrar assistant");
    expect(within(table).queryByText("Advising bot")).toBeNull();
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Registrar assistant" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const sheet = await screen.findByRole("region", { name: "Registrar assistant" });
    expect(router.state.location.search).toMatchObject({ record: "ag1", audience: "team" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Short name" }), "reg");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save short name" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ shortName: "reg" }));
  });

  it("shows the server's refusal of a short name under the field", async () => {
    mockApi(adminRoutes("platform_admin", { "PUT /v1/admin/agents/ag1/short-name": () => Reply.error(400, "reserved_short_name", "That short name is reserved.") }));
    renderApp("/admin/agents?record=ag1");
    const page = await screen.findByRole("region", { name: "Registrar assistant" }, { timeout: 4000 });
    const field = within(page).getByRole("textbox", { name: "Short name" });
    await userEvent.type(field, "admin");
    await userEvent.click(within(page).getByRole("button", { name: "Save short name" }));
    await waitFor(() => expect(field).toHaveAccessibleDescription(/That short name is reserved/));
    expect(within(page).queryByRole("alert", { name: /Something went wrong/ })).toBeNull();
  });

  it("Back asks before leaving an unsaved short name, as other forms do (AD-23)", async () => {
    mockApi(adminRoutes("platform_admin"));
    renderApp("/admin/agents?record=ag1");
    const page = await screen.findByRole("region", { name: "Registrar assistant" }, { timeout: 4000 });
    await userEvent.type(within(page).getByRole("textbox", { name: "Short name" }), "x!");
    await userEvent.click(screen.getByRole("link", { name: /^Back/ }));
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeInTheDocument();
  });

  it("auditors see agents read-only", async () => {
    mockApi(adminRoutes("platform_auditor"));
    renderApp("/admin/agents");
    const table = await screen.findByRole("table", { name: "Agents" });
    await within(table).findByText("Registrar assistant");
    expect(within(table).queryByRole("button", { name: /^(Disable|Enable) / })).toBeNull();
  });
});
