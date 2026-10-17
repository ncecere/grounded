/*
 * Chat polish from the v0.6.0 QA pass (#128): the target sizes of the chip, the header's team link and the breadcrumb
 * link, where the team link goes, the profile's role column, and the thumbs-down reasons as a radio group.
 * jsdom does no layout: the CSS tests read the rules and say so; nothing here was checked in a browser.
 */
import { readFileSync } from "node:fs";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Feedback, type SendFeedback } from "../pages/chat/notes";
import { type AssistantItem, pendingAssistant } from "../pages/chat/stream";
import { meFor, mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(file: string, selector: string): string {
  const css = readFileSync(file, "utf8");
  const start = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`));
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("\n}", open));
}

describe("target sizes (WCAG 2.5.8)", () => {
  it("the citation chip button itself is 24 x 24 px, the pill inside it as small as before", () => {
    const r = rule("src/pages/chat/answer.module.css", "button.chip");
    expect(r).toMatch(/height:\s*1\.5rem/);
    expect(r).toMatch(/min-width:\s*1\.625rem/);
    expect(r).toMatch(/border:\s*0\.1875rem solid transparent/);
    expect(r).toMatch(/background-clip:\s*padding-box/);
  });

  it("the chat header's team link and the breadcrumb links are at least 24 px", () => {
    expect(rule("src/pages/chat/agent-info.module.css", "a.teamLink")).toMatch(/min-height:\s*1\.5rem/);
    expect(rule("src/pages/chat/agent-info.module.css", "a.teamLink")).toMatch(/min-width:\s*1\.5rem/);
    expect(rule("src/components/layout/layout.module.css", ".crumbs a")).toMatch(/min-height:\s*1\.5rem/);
  });
});

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi!",
  starterQuestions: [],
  citationMode: "snippet_link",
  status: "active",
};

describe("the chat header's team link", () => {
  it("goes to Discover agents filtered to that team, and the directory asks for that team", async () => {
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      // Two teams' agents: the directory's Team filter exists then (it is left out for a single team).
      "GET /v1/agents": () => [card, { ...card, id: "ag2", teamSlug: "library", teamName: "University Library", slug: "library-help", name: "Library help" }],
    });
    renderApp("/a/registrar/registrar-assistant");
    const link = await screen.findByRole("link", { name: /^Office of the Registrar: see agents/ }, { timeout: scaled(4000) });
    expect(link).toHaveAttribute("href", "/agents?team=registrar");
    await userEvent.click(link);
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/agents" && c.search.get("team") === "registrar"), JSON.stringify(calls.map((c) => c.url + "?" + c.search))).toBe(true));
  });
});

describe("the profile's teams", () => {
  it("puts the role in a column of its own", async () => {
    const library = { id: "t2", slug: "library", name: "University Library with a rather long name", status: "active", maxClassification: "open", role: "member" };
    const base = meFor();
    mockApi({ ...shellRoutes(), "GET /v1/me": () => ({ ...base, user: { ...base.user, createdAt: "2026-03-02T09:00:00Z" }, teams: [...base.teams, library] }) });
    renderApp("/settings/profile");
    const teams = await screen.findByRole("region", { name: "Your teams" }, { timeout: scaled(4000) });
    const rows = within(teams).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const li of rows) expect(li.className).toMatch(/teamRow/);
    const r = rule("src/pages/account/account.module.css", ".teamRow");
    expect(r).toMatch(/display:\s*grid/);
    expect(r).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) \d/);
  });
});

function Harness({ initial }: { initial?: AssistantItem["feedback"] }) {
  const [item, setItem] = useState<AssistantItem>({ ...pendingAssistant(), id: "m1", text: "Answer.", status: "done", feedback: initial });
  const send: SendFeedback = async (_id, body) => ({ rating: body.rating, reason: body.reason, shared: false });
  return <Feedback item={item} send={send} onChange={(f) => setItem((x) => ({ ...x, feedback: f }))} />;
}

describe("the thumbs-down reasons", () => {
  it("are radio items, and the reason already given is the checked one", async () => {
    renderBare(<Harness initial={{ rating: "down", reason: "outdated" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Bad answer: Outdated" }));
    const group = await screen.findByRole("group", { name: "What was wrong?" });
    const radios = within(group).getAllByRole("menuitemradio");
    expect(radios.length).toBeGreaterThan(2);
    expect(within(group).queryAllByRole("menuitem")).toHaveLength(0);
    expect(within(group).getByRole("menuitemradio", { name: "Outdated" })).toHaveAttribute("aria-checked", "true");
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    // The check is visible: the chosen item holds the menu's selection dot, the others do not.
    expect(within(group).getByRole("menuitemradio", { name: "Outdated" }).querySelector("[class*=radioDot]")).not.toBeNull();
    expect(radios.filter((r) => r.querySelector("[class*=radioDot]"))).toHaveLength(1);
  });

  it("show none checked before a rating, and the new reason after choosing one", async () => {
    renderBare(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Bad answer" }));
    const before = await screen.findAllByRole("menuitemradio");
    expect(before.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Missing sources" }));
    await userEvent.click(await screen.findByRole("button", { name: "Bad answer: Missing sources" }));
    expect(await screen.findByRole("menuitemradio", { name: "Missing sources" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Outdated" })).toHaveAttribute("aria-checked", "false");
  });
});
