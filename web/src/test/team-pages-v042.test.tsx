/* v0.4.2 M3 fixes on the team pages: knowledge base settings and overview, sources, keys and read-only notices. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "../api/client";
import { TeamContext, teamCtx } from "../pages/team/common";
import { runOptionLabel } from "../pages/team/evaluations/labels";
import { sliderText } from "../pages/team/kbs/fusion";
import { KBSettings } from "../pages/team/kbs/settings";
import { axe } from "vitest-axe";
import { run } from "./evaluations-fixtures";
import { meFor, mockApi, renderApp, renderBare, shellRoutes, team } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const stamp = { revision: 1, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

const kb = {
  id: "k1",
  name: "Registrar",
  description: "",
  embeddingProfileId: "p1",
  topK: 8,
  sources: [],
  fusionWeights: null,
  effectiveFusionWeights: { vector: 1, keyword: 0.02 },
  fusionWeightsSource: "profile",
  ...stamp,
} as unknown as Schemas["KnowledgeBase"];

describe("knowledge base fusion weights (BU-14)", () => {
  it("shows and keeps a keyword weight of 0.02 on the slider", async () => {
    mockApi({});
    renderBare(
      <TeamContext.Provider value={teamCtx(team as Schemas["Team"], "editor")}>
        <KBSettings kb={kb} onDelete={() => {}} />
      </TeamContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("switch", { name: /Use the default/ }));
    const keyword = screen.getByRole("slider", { name: "Keyword weight" });
    expect(keyword).toHaveAttribute("step", "0.01");
    expect(keyword).toHaveValue("0.02");
    expect(keyword).toHaveAttribute("aria-valuenow", "0.02");
    expect(sliderText(0.019999999552965164)).toBe("0.02");
    expect(sliderText([0.30000000000000004])).toBe("0.3");
  });
});

describe("New API key: Expires on (BU-18)", () => {
  it("is a calendar button named once, not a native date input with doubled segment names", async () => {
    mockApi({
      ...shellRoutes("none", "owner"),
      "GET /v1/teams/registrar/api-keys": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/agents": () => [],
      "GET /v1/teams/registrar/members": () => [],
    });
    const { container } = renderApp("/teams/registrar/settings?tab=api-keys");
    await userEvent.click(await screen.findByRole("button", { name: "New API key" }));
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
    const expires = within(dialog).getByRole("button", { name: /^Expires on/ });
    expect(expires).toHaveTextContent("Never");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("what a member may do, said the same way (VI-20, VI-20b)", () => {
  const memberRoutes = () => {
    const shell = shellRoutes("none", "member");
    return {
      ...shell,
      "GET /v1/me": () => ({ ...meFor("none", "member"), capabilities: { platformAdmin: false, platformAuditor: false, evaluations: true } }),
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/agents": () => [],
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => [],
    };
  };

  it("tells a member who opens Evaluations, an evaluation set or Gaps that only editors see them", async () => {
    mockApi(memberRoutes());
    const { container, unmount } = renderApp("/teams/registrar/evaluations");
    expect(await screen.findByText("Only editors, admins and owners can see evaluations.")).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    renderApp("/teams/registrar/evaluations/5f0c6a52-0000-4000-8000-000000000001");
    expect(await screen.findByText("Only editors, admins and owners can see evaluations.")).toBeInTheDocument();
    expect(screen.queryByText("Not found")).toBeNull();
  });

  it("tells a member who opens Gaps that only editors see them", async () => {
    mockApi(memberRoutes());
    renderApp("/teams/registrar/gaps");
    expect(await screen.findByText("Only editors, admins and owners can see gaps.")).toBeInTheDocument();
  });

  it("shows one untitled notice on knowledge bases and members", async () => {
    mockApi(memberRoutes());
    const { unmount } = renderApp("/teams/registrar/kbs");
    expect(await screen.findByText("Members can view knowledge bases. Editors, admins and owners can change them.")).toBeInTheDocument();
    unmount();
    renderApp("/teams/registrar/settings");
    expect(await screen.findByText("Members can view the team's members. Admins and owners can add, change and remove them.")).toBeInTheDocument();
  });

  it("tells an owner that only platform admins change General (BU-16)", async () => {
    mockApi({ ...shellRoutes("none", "owner"), "GET /v1/teams/registrar/members": () => [], "GET /v1/teams/registrar/invites": () => [] });
    renderApp("/teams/registrar/settings?tab=general");
    expect(await screen.findByText("You can view these settings. Only platform admins can change them.")).toBeInTheDocument();
    expect(screen.queryByText(/your role can't change them/)).toBeNull();
  });
});

describe("tab content without a second page header (VI-12)", () => {
  it("puts Request a domain in the Data sources header on Crawl domains, with no second heading", async () => {
    mockApi({
      ...shellRoutes("none", "owner"),
      "GET /v1/teams/registrar/sources": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "GET /v1/teams/registrar/domain-requests": () => [],
    });
    const { container } = renderApp("/teams/registrar/sources?tab=crawl-domains");
    const header = (await screen.findByRole("heading", { level: 1, name: "Data sources" })).closest("header") ?? document.body;
    expect(await within(header as HTMLElement).findByRole("button", { name: "Request a domain" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Request a domain" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2, name: "Crawl domains" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Request a domain" }));
    expect(await screen.findByRole("dialog", { name: "Request a domain" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Compare runs (BU-20)", () => {
  it("labels each run to the second, with its score and what it ran with", () => {
    const a = run("r1", "2026-10-04T14:48:05Z", { summary: { ...run("x", "2026-10-04T14:48:05Z").summary, recall: 0.8 } });
    const b = { ...a, id: "r2", createdAt: "2026-10-04T14:48:40Z", config: { ...a.config, rerank: "off" as const } };
    expect(runOptionLabel(a)).not.toBe(runOptionLabel(b));
    expect(runOptionLabel(a)).toMatch(/:48:05.*80%/);
    expect(runOptionLabel(b)).toMatch(/not reranked/);
  });
});
