/* Document permissions (docs/document-permissions.md): a source's Access tab (restrict to groups and people, offer groups
 * seen at sign-in, back to everyone, the switch being off), the Restricted badges, and the platform switch in Features. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { accessSummary, splitPrincipals } from "../pages/sources/access";
import { SourceDetail } from "../pages/sources/detail";
import { mockApi as mockAppApi, renderApp, shellRoutes } from "./harness";
import { ApiFailure, common, mockApi, renderWith, webSource } from "./web-harness";

const source = (access?: Schemas["SourceAccess"]) =>
  webSource({ type: "upload", web: null, name: "HR policies", lastSyncAt: null, nextSyncAt: null, revision: 4, access });

const routes = (src: Schemas["DataSource"]) => ({
  ...common,
  "GET /v1/teams/registrar/sources/s1": () => src,
  "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: [], nextCursor: null }),
  "GET /v1/teams/registrar/sources/s1/tags": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/access/groups": () => ["hr-staff", "payroll"],
});

async function openAccess() {
  await userEvent.click(await screen.findByRole("tab", { name: /Access/ }));
  return screen.findByRole("radiogroup", { name: "Access" });
}

describe("document permissions", () => {
  it("splits and summarises a restriction", () => {
    expect(splitPrincipals(["group:hr", "email:a@x.edu", "user:1"])).toEqual({ groups: ["hr"], emails: ["a@x.edu"], others: ["user:1"] });
    expect([accessSummary([]), accessSummary(["group:hr"]), accessSummary(["group:hr", "email:a@x.edu"])]).toEqual([
      "Nobody", "1 group or person", "2 groups and people",
    ]);
  });

  it("restricts a source to groups and people, with groups seen at sign-in offered", async () => {
    const calls = mockApi({
      ...routes(source()),
      "PUT /v1/teams/registrar/sources/s1/access": () => source({ restricted: true, principals: ["group:hr-staff", "email:dean@example.edu"] }),
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await openAccess();
    const save = screen.getByRole("button", { name: "Save access" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Only some groups and people/ }));
    expect(screen.getByText("Add at least one group or person, or choose Everyone.")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Add group hr-staff" }));
    await userEvent.type(screen.getByRole("textbox", { name: "People" }), "Dean@Example.edu{Enter}");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(save);
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ principals: ["group:hr-staff", "email:dean@example.edu"] });
      expect(put?.headers.get("If-Match")).toBe('"4"');
    });
    expect(await screen.findByText(/only the groups and people you chose can read this source/)).toBeInTheDocument();
  });

  it("makes a restricted source unrestricted, and shows it restricted until then", async () => {
    const calls = mockApi({
      ...routes(source({ restricted: true, principals: ["group:hr-staff"] })),
      "PUT /v1/teams/registrar/sources/s1/access": () => source({ restricted: false, principals: [] }),
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    expect(await screen.findByTitle("Restricted to 1 group or person")).toHaveTextContent("Restricted");
    await openAccess();
    await userEvent.click(screen.getByRole("radio", { name: /Everyone who can use the knowledge/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ principals: null }));
  });

  it("says why it can't be saved while document permissions are off", async () => {
    mockApi({
      ...routes(source()),
      "PUT /v1/teams/registrar/sources/s1/access": () => {
        throw new ApiFailure(409, "document_permissions_off", "Document permissions are off. A platform admin turns them on in Admin → Settings → Features.");
      },
    });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await openAccess();
    await userEvent.click(screen.getByRole("radio", { name: /Only some groups and people/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Groups" }), "hr{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save access" }));
    expect(await screen.findByText(/Document permissions are off/)).toBeInTheDocument();
    expect(screen.getByText("Access wasn't saved")).toBeInTheDocument();
  });

  it("hides the Access tab from members", async () => {
    mockApi(routes(source()));
    renderWith(<SourceDetail sourceId="s1" />, { role: "member" });
    expect(await screen.findByRole("tab", { name: /Documents/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Access/ })).toBeNull();
  });

  it("turns the platform switch on, and keeps it on while documents are restricted", async () => {
    let current: Schemas["DocumentAccessSettings"] = { enabled: false, revision: 1, restrictedDocuments: 0 };
    const calls = mockAppApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/document-access": () => current,
      "PUT /v1/admin/document-access": (b) => (current = { ...current, enabled: (b as { enabled: boolean }).enabled, revision: 2 }),
    });
    const { container } = renderApp("/admin/settings?tab=features");
    const toggle = await screen.findByRole("switch", { name: "Allow document permissions" });
    expect(screen.getByText(/Turn it on once every server runs this release/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.method === "PUT" && c.url === "/v1/admin/document-access")?.body).toEqual({ enabled: true }));
  });

  it("keeps the switch on while documents are restricted", async () => {
    mockAppApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/document-access": () => ({ enabled: true, revision: 3, restrictedDocuments: 12 }) });
    renderApp("/admin/settings?tab=features");
    expect(await screen.findByText(/12 documents are restricted now/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Allow document permissions" })).toHaveAttribute("aria-disabled", "true");
  });
});
