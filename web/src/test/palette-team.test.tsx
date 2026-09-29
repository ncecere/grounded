/*
 * ⌘K inside a team (docs/v0.2.0.md §7, docs/v0.2.1.md): the words people
 * type for team pages (spend, budget, members, api keys, audit) lead to Team
 * settings' tabs, "crawl" to Data sources › Crawl domains, "evaluations" to
 * the team's Evaluations page, and on a knowledge base, agent or source the
 * page's own tabs (Try it, Evaluations, OCR settings), each only where its
 * tab shows.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { meFor, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function routes(teamRole = "owner", evaluations = true) {
  const me = meFor("none", teamRole);
  return {
    ...shellRoutes("none", teamRole),
    "GET /v1/me": () => ({ ...me, capabilities: { ...me.capabilities, evaluations } }),
    "GET /v1/agents": () => [],
    "GET /v1/search": () => [],
  };
}

async function palette(path: string) {
  const utils = renderApp(path);
  const user = userEvent.setup();
  await screen.findByRole("navigation", { name: "Main" });
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("combobox", { name: "Command palette" });
  const search = async (text: string) => {
    await user.clear(input);
    await user.type(input, text);
    return within(dialog).queryAllByRole("option").map((o) => o.textContent ?? "");
  };
  return { ...utils, user, dialog, search };
}

describe("⌘K team places", () => {
  it("takes an owner's spend, budget and usage words to Usage & limits, and finds members by plural or prefix", async () => {
    mockApi(routes());
    const { router, user, dialog, search } = await palette("/teams/registrar");
    for (const word of ["spend", "cost", "budget", "usage"]) {
      expect(await search(word), word).toContain("Usage & limitsTeam settings");
    }
    for (const word of ["members", "member", "memb"]) {
      const found = await search(word);
      expect(found, word).toContain("MembersTeam settings");
      expect(found, word).toContain("Add member");
    }
    expect(await search("api keys")).toEqual(expect.arrayContaining(["API keysTeam settings", "New API key"]));
    expect(await search("audit")).toContain("Audit logTeam settings");
    expect(await search("crawl domains")).toContain("Crawl domainsData sources");
    // The team's Evaluations page (I3); "regression" and "eval" find it too.
    for (const word of ["evaluations", "eval", "regression"]) {
      expect(await search(word), word).toContain("EvaluationsOffice of the Registrar");
    }
    expect(await axe(document.body)).toHaveNoViolations();

    await search("crawl");
    await user.click(within(dialog).getByRole("option", { name: /Crawl domains/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(router.state.location.search).toMatchObject({ tab: "crawl-domains" });

    await user.keyboard("{Control>}k{/Control}");
    const again = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(again).getByRole("combobox"), "evaluations");
    await user.click(within(again).getByRole("option", { name: /^Evaluations/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/evaluations"));

  });

  it("takes spend words to the usage tab", async () => {
    mockApi(routes());
    const { router, user, dialog, search } = await palette("/teams/registrar");
    await search("spend");
    await user.click(within(dialog).getByRole("option", { name: /Usage & limits/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/settings"));
    expect(router.state.location.search).toMatchObject({ tab: "usage" });
  });

  it("gives a member the tabs they can open, not Usage & limits or the audit log", async () => {
    mockApi(routes("member"));
    const { search } = await palette("/teams/registrar");
    expect(await search("spend")).toEqual([]);
    expect(await search("usage")).toEqual([]);
    expect(await search("audit")).toEqual([]);
    expect(await search("members")).toContain("MembersTeam settings");
    // Evaluations are for editors and above.
    expect(await search("evaluations")).toEqual([]);
  });

  it("opens a knowledge base's Try it and Evaluations tabs from its page", async () => {
    mockApi(routes("editor"));
    const { router, user, dialog, search } = await palette("/teams/registrar/kbs/kb1");
    expect(await search("evaluations")).toEqual(expect.arrayContaining(["EvaluationsThis knowledge base", "EvaluationsOffice of the Registrar"]));
    await user.click(within(dialog).getByRole("option", { name: /Evaluations.*This knowledge base/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "evaluations" }));
    expect(router.state.location.pathname).toBe("/teams/registrar/kbs/kb1");

    await user.keyboard("{Control>}k{/Control}");
    const again = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(again).getByRole("combobox"), "try");
    await user.click(within(again).getByRole("option", { name: /Try it/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "try" }));
    void dialog;
  });

  it("hides Evaluations while the feature is off", async () => {
    mockApi(routes("editor", false));
    const { search } = await palette("/teams/registrar/kbs/kb1");
    expect(await search("evaluations")).toEqual([]);
    expect(await search("try")).toContain("Try itThis knowledge base");
  });

  it("opens an agent's Try it panel and a source's OCR settings", async () => {
    mockApi(routes("editor"));
    const agent = await palette("/teams/registrar/agents/ag1");
    expect(await agent.search("try")).toContain("Try itThis agent");
    await agent.user.click(within(agent.dialog).getByRole("option", { name: /Try it/ }));
    await waitFor(() => expect(agent.router.state.location.search).toMatchObject({ test: "open" }));
    agent.unmount();

    const source = await palette("/teams/registrar/sources/s1");
    expect(await source.search("ocr")).toContain("OCR settingsThis data source");
    await source.user.click(within(source.dialog).getByRole("option", { name: /OCR settings/ }));
    await waitFor(() => expect(source.router.state.location.search).toMatchObject({ tab: "settings" }));
    expect(source.router.state.location.hash).toBe("ocr");
  });
});
