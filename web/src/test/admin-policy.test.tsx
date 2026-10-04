/* Admin → Classifications (A8): per-level settings and counts, edited in a sheet. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { hoursText, levelCounts } from "../pages/admin/policy";
import { Reply, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const level = (key: string, name: string, rank: number, extra: Partial<Schemas["Classification"]> = {}): Schemas["Classification"] => ({
  key,
  name,
  description: "",
  rank,
  maxAudience: rank === 0 ? "public" : "team",
  anonymousRetentionHours: 24,
  conversationRetentionDays: null,
  allowedSourceTypes: ["upload", "web"],
  directRetrieve: true,
  revision: 1,
  createdAt: "",
  updatedAt: "",
  ...extra,
});
const levels = [
  level("open", "Open", 0),
  level("sensitive", "Sensitive", 1, { conversationRetentionDays: 90 }),
  level("restricted", "Restricted", 2, { allowedSourceTypes: ["upload"], directRetrieve: false }),
];
const model = (id: string, maxClassification: string, enabled = true) => ({ id, maxClassification, enabled, kind: "chat", displayName: id });
const team = (slug: string, maxClassification: string) => ({ team: { id: slug, slug, name: slug, maxClassification, status: "active" }, memberCount: 1, ownerCount: 1 });

describe("admin classifications", () => {
  it("shows each level's settings and counts, and saves settings from the sheet", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/classifications": () => levels,
      "GET /v1/admin/models": () => [model("a", "restricted"), model("b", "sensitive"), model("c", "restricted", false)],
      "GET /v1/admin/teams": () => ({ items: [team("x", "sensitive"), team("y", "restricted")], nextCursor: null }),
      "PATCH /v1/admin/classifications/restricted": (body) => ({ ...levels[2], ...(body as object) }),
    });
    const { container } = renderApp("/admin/classifications");
    const table = await screen.findByRole("table", { name: "Classifications" }, { timeout: 4000 });
    const row = (await within(table).findByText("Restricted")).closest("tr")!;
    expect(row).toHaveTextContent("Uploads");
    expect(row).toHaveTextContent("Agents only");
    await waitFor(() => expect(row).toHaveTextContent(/Agents only\s*1\s*1/));
    expect(within(table).getByText("90 days")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(row).getByRole("button", { name: "Actions for Restricted" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("region", { name: "Edit Restricted" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Signed-in conversations/ }), "30");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Websites" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save level" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
      conversationRetentionDays: 30,
      allowedSourceTypes: ["upload", "web"],
      directRetrieve: false,
      anonymousRetentionHours: 24,
    });
  });

  it("deletes an unused level, and says what uses one that can't be deleted (AD-05)", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/classifications": () => levels,
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "DELETE /v1/admin/classifications/sensitive": () =>
        Reply.error(409, "classification_in_use", "This level is in use by 1 team, 3 data sources. Move them to another level first."),
      "DELETE /v1/admin/classifications/restricted": () => ({ ok: true }),
    });
    renderApp("/admin/classifications");
    const table = await screen.findByRole("table", { name: "Classifications" }, { timeout: 4000 });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Sensitive" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    let dialog = await screen.findByRole("alertdialog", { name: "Delete Sensitive?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete level" }));
    expect(await within(dialog).findByText(/in use by 1 team, 3 data sources/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Restricted" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    dialog = await screen.findByRole("alertdialog", { name: "Delete Restricted?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete level" }));
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE" && c.url.endsWith("/restricted"))?.headers.get("If-Match")).toBe('"1"'));
  });

  it("says what adding a level does before it's added (AD-05)", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/classifications": () => levels, "GET /v1/admin/models": () => [], "GET /v1/admin/teams": () => ({ items: [] }) });
    const { container } = renderApp("/admin/classifications?form=new");
    expect(await screen.findByText("A new level applies to every team at once", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/You can delete it again while nothing uses it/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("counts models and teams per level", () => {
    const counts = levelCounts(levels, [model("a", "restricted"), model("b", "open"), model("c", "restricted", false)], [{ maxClassification: "sensitive" }]);
    expect(counts.get("open")).toEqual({ models: 2, teams: 1 });
    expect(counts.get("restricted")).toEqual({ models: 1, teams: 0 });
    expect(hoursText(24)).toBe("24 hours");
    expect(hoursText(72)).toBe("3 days");
  });
});
