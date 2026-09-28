/* A revoked API key opens from its audit-log link (G12): the list shows active keys only, so the record page loads the key by id. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const revoked: Schemas["APIKey"] = {
  id: "key9",
  name: "Old loader",
  kind: "service",
  prefix: "rag_old",
  userId: "u1",
  scopes: ["ingest"],
  knowledgeBaseIds: null,
  agentIds: null,
  contact: { userId: "u1", name: "Una User", email: "una@example.edu" },
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: "2026-09-27T09:00:00Z",
  createdAt: "2026-09-01T09:00:00Z",
};

const revokeEntry: Schemas["AuditEntry"] = {
  id: 7,
  occurredAt: "2026-09-27T09:00:00Z",
  actorKind: "user",
  actor: { kind: "user", userId: "u1", displayName: "Una User", email: "una@example.edu" },
  action: "apikey.revoke",
  targetType: "api_key",
  targetId: "key9",
  targetLabel: "Old loader",
  targetExists: true,
  metadata: {},
  requestId: "r1",
};

function routes(keyById: () => unknown) {
  return {
    ...shellRoutes("none", "owner"),
    "GET /v1/teams/registrar/audit": () => ({ items: [revokeEntry], nextCursor: null }),
    "GET /v1/teams/registrar/members": () => [],
    "GET /v1/teams/registrar/api-keys": () => [],
    "GET /v1/teams/registrar/api-keys/key9": keyById,
    "GET /v1/teams/registrar/kbs": () => [],
    "GET /v1/teams/registrar/agents": () => [],
  };
}

describe("revoked API keys", () => {
  it("opens from the audit log on its record page, read-only", async () => {
    mockApi(routes(() => revoked));
    const { container } = renderApp("/teams/registrar/settings?tab=audit");
    const table = await screen.findByRole("table", { name: "Audit log" });
    const link = await within(table).findByRole("link", { name: "Old loader" });
    expect(link).toHaveAttribute("href", "/teams/registrar/settings?tab=api-keys&record=key9");

    await userEvent.click(link);
    const page = await screen.findByRole("region", { name: "Old loader" });
    expect(page).toHaveTextContent("A revoked API key of this team. It no longer works.");
    expect(within(page).getByText("Revoked")).toBeInTheDocument();
    expect(within(page).getByText("Team service key")).toBeInTheDocument();
    // Nothing to change on a revoked key.
    expect(within(page).queryByRole("button", { name: "Revoke key" })).toBeNull();
    expect(within(page).queryByRole("combobox", { name: "Contact" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says so when the key can't be read", async () => {
    mockApi(routes(() => undefined)); // 404
    renderApp("/teams/registrar/settings?tab=api-keys&record=key9");
    expect(await screen.findByText("This key doesn't exist, or you can't see it.")).toBeInTheDocument();
  });
});
