/* Every query of one team sits under ["team", slug, …], so invalidating the team (a config import, #252) reaches all of
 * them: a KB's profile migration and index preview, and the access groups of a source's Access tab. */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SourceDetail } from "../pages/sources/detail";
import { useIndexPreview } from "../pages/team/kbs/index-preview";
import { useKBMigration } from "../pages/team/kbs/migration";
import { testQueryClient } from "./query-client";
import { common, mockApi, renderWith, webSource } from "./web-harness";

const count = (calls: { method: string; url: string }[], url: string) => calls.filter((c) => c.method === "GET" && c.url === url).length;

describe("team query keys", () => {
  it("refreshes a knowledge base's migration and index preview when the team's queries are invalidated", async () => {
    const calls = mockApi({
      "GET /v1/teams/registrar/kbs/k1/profile-migration": () => null,
      "GET /v1/teams/registrar/kbs/k1/index-preview": () => ({ running: false, sets: [] }),
    });
    const qc = testQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const migration = renderHook(() => useKBMigration("registrar", "k1"), { wrapper });
    const preview = renderHook(() => useIndexPreview("registrar", "k1", true), { wrapper });
    await waitFor(() => expect(migration.result.current.isSuccess && preview.result.current.isSuccess).toBe(true));
    await qc.invalidateQueries({ queryKey: ["team", "registrar"] });
    expect(count(calls, "/v1/teams/registrar/kbs/k1/profile-migration")).toBe(2);
    expect(count(calls, "/v1/teams/registrar/kbs/k1/index-preview")).toBe(2);
  });

  it("refreshes the access groups of a source's Access tab when the team's queries are invalidated", async () => {
    const src = webSource({ type: "upload", web: null, name: "HR policies", lastSyncAt: null, nextSyncAt: null, revision: 4, access: { restricted: true, principals: ["group:hr-staff"] } });
    const calls = mockApi({
      ...common,
      "GET /v1/teams/registrar/sources/s1": () => src,
      "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: [], nextCursor: null }),
      "GET /v1/teams/registrar/sources/s1/tags": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/access/groups": () => ["hr-staff", "payroll"],
    });
    const { qc } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    await userEvent.click(await screen.findByRole("tab", { name: /Access/ }));
    await waitFor(() => expect(count(calls, "/v1/teams/registrar/access/groups")).toBe(1));
    await qc.invalidateQueries({ queryKey: ["team", "registrar"] });
    expect(count(calls, "/v1/teams/registrar/access/groups")).toBe(2);
  });
});
