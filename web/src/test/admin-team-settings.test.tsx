/* E16: auditors read saved team facts, never a disabled editor. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { meFor, mockApi, renderApp, shellRoutes, team } from "./harness";

function routes(role: "platform_admin" | "platform_auditor" | "none", description = "", classification = "sensitive") {
  return {
    ...shellRoutes(role),
    "GET /v1/admin/teams/registrar": () => ({
      team: { ...team, description, maxClassification: classification },
      memberCount: 1, ownerCount: 1, ownerInvites: 0, agentCount: 0,
      sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0,
    }),
  };
}

describe("admin team Settings facts", () => {
  it.each(["", "Details for team members"])("shows auditor semantic saved facts (%s), without editor controls or writes", async (description) => {
    const calls = mockApi(routes("platform_auditor", description));
    const { container, router } = renderApp("/admin/teams/registrar?tab=settings");
    await router.load();
    const general = (await screen.findByRole("heading", { name: "General" })).closest("section")!;
    const facts = general.querySelector("dl")!;
    expect(facts).not.toBeNull();
    expect([...facts.querySelectorAll("dt")].map((e) => e.textContent)).toEqual(["Name", "Description", "Approved classification"]);
    expect([...facts.querySelectorAll("dd")].map((e) => e.textContent)).toEqual([team.name, description || "No description", "Sensitive"]);
    expect(general.querySelector("input, textarea, select")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save settings|Discard|Archive team|Unarchive team/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await userEvent.tab();
    expect(document.activeElement).not.toBe(document.body);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("keeps an unknown saved classification visible rather than inventing a default", async () => {
    mockApi(routes("platform_auditor", "", "future-level"));
    const { router } = renderApp("/admin/teams/registrar?tab=settings");
    await router.load();
    const general = (await screen.findByRole("heading", { name: "General" })).closest("section")!;
    expect(within(general).getByText("future-level")).toBeInTheDocument();
  });

  it("preserves admin validation, discard, enabled controls and revision-aware save", async () => {
    let saved = { ...team };
    const summary = () => ({
      team: saved, memberCount: 1, ownerCount: 1, ownerInvites: 0, agentCount: 0,
      sourceCount: 0, kbCount: 0, documentCount: 0, storageBytes: 0,
    });
    const calls = mockApi({
      ...routes("platform_admin"),
      "GET /v1/admin/teams/registrar": summary,
      "PATCH /v1/admin/teams/registrar": (body: unknown) => {
        saved = { ...saved, ...(body as object), revision: 2 };
        return { team: saved };
      },
    });
    const { router, container } = renderApp("/admin/teams/registrar?tab=settings");
    await router.load();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Approved classification" })).toBeEnabled();
    await userEvent.clear(name);
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(name).toHaveValue(team.name);
    await userEvent.clear(name);
    await userEvent.type(name, "Registrar");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ name: "Registrar", description: "", maxClassification: "sensitive" });
    expect(patch.headers.get("If-Match")).toBe('"1"');
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull());
    expect(name).toHaveValue("Registrar");
    expect(await screen.findByText("Team saved")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([true, false])("does not admit ordinary users (team member: %s) to admin settings", async (member) => {
    const calls = mockApi({
      ...routes("none"),
      "GET /v1/me": () => ({ ...meFor("none"), teams: member ? meFor("none").teams : [] }),
    });
    const { router } = renderApp("/admin/teams/registrar?tab=settings");
    await router.load();
    expect(await screen.findByRole("heading", { name: "No access" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/v1/admin/teams/registrar")).toBe(false);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
