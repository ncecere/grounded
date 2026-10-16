/* Router agents (v0.6.0, C5): the answer says which agent answered, the editor swaps Knowledge for Routing, and Share lets an agent be reached. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { ViewerHost } from "../pages/chat/viewer/host";
import { applyChatEvent, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { scaled } from "../../test-scale";
import { type Handler, mockApi, renderApp, renderBare, shellRoutes } from "./harness";

const routed: Schemas["RoutedTo"] = { agentId: "a2", name: "Parking help", slug: "parking", teamSlug: "transport", teamName: "Transportation", conversationId: "c9" };
const answer = (extra: Record<string, unknown> = {}) => applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text: "Permits are sold online.", citations: [], ...extra });

describe("a routed answer", () => {
  it("keeps who answered from message_end and from a stored conversation", () => {
    expect(answer({ routedTo: routed }).routedTo).toEqual(routed);
    expect(answer().routedTo).toBeUndefined();
    expect(answer({ routedTo: "no" }).routedTo).toBeUndefined();
    const stored = itemsFromConversation([
      { id: "u1", seq: 1, role: "user", text: "Where?", createdAt: "2026-10-16T10:00:00Z" },
      { id: "m1", seq: 2, role: "assistant", text: "Online.", stopReason: "stop", routedTo: routed, createdAt: "2026-10-16T10:00:01Z" },
    ]);
    expect(stored[1]).toMatchObject({ routedTo: routed });
  });

  it("names the agent and its team, and links to the conversation there for the person's own conversation", async () => {
    const items = [{ role: "user" as const, key: "u1", text: "Where do I park?" }, { ...answer({ routedTo: routed }), status: "done" as const }];
    const { container } = renderBare(
      <ViewerHost access={{ kind: "message" }} items={items}>
        <ChatMessages items={items} agent={{ name: "Front door" }} />
      </ViewerHost>,
    );
    expect(await screen.findByText(/Answered by/)).toHaveTextContent("Answered by Parking help · Transportation");
    const link = screen.getByRole("link", { name: "Continue there" });
    expect(link).toHaveAttribute("href", "/a/transport/parking?c=c9");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers no link where the conversation is not the viewer's, or when the agent is gone", async () => {
    const items = [{ ...answer({ routedTo: routed }), status: "done" as const }];
    const first = renderBare(<ChatMessages items={items} agent={{ name: "Front door" }} />);
    expect(await screen.findByText(/Answered by/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue there" })).toBeNull();
    first.unmount();
    const gone = [{ ...answer({ routedTo: { ...routed, gone: true } }), status: "done" as const }];
    renderBare(
      <ViewerHost access={{ kind: "message" }} items={gone}>
        <ChatMessages items={gone} agent={{ name: "Front door" }} />
      </ViewerHost>,
    );
    expect(await screen.findByText(/Answered by/)).toHaveTextContent("Parking help (removed since)");
    expect(screen.queryByRole("link", { name: "Continue there" })).toBeNull();
  });

  it("says nothing about routing on an ordinary answer", async () => {
    renderBare(<ChatMessages items={[{ ...answer(), status: "done" as const }]} agent={{ name: "Helper" }} />);
    expect(await screen.findByText("Permits are sold online.")).toBeInTheDocument();
    expect(screen.queryByText(/Answered by/)).toBeNull();
  });
});

/* ---- the editor ---- */

const baseConfig: Schemas["AgentConfig"] = {
  instructions: "Send people to the right place.",
  chatModelId: "mod1",
  kbs: [],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "I couldn't find an answer to that in the sources I have.",
  citationMode: "snippet_link",
  queryRewrite: true,
  moderation: { categories: {}, outputMode: "" },
  audience: "team",
  routable: false,
  router: false,
};

const version = { id: "v1", version: 1, publishedAt: "2026-10-16T10:00:00Z", publishedBy: "u1", publishedByName: "Una", note: "", chatModelId: "mod1", chatModelName: "Model", effectiveRank: 0, classification: "open", knowledgeBases: [], config: baseConfig };

const agent = (config: Partial<Schemas["AgentConfig"]> = {}): Schemas["Agent"] => ({
  id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "door", name: "Front door", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
  status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: { ...baseConfig, ...config }, draftRevision: 1, published: version, hasUnpublishedChanges: false,
  warnings: [], revision: 2, createdAt: "2026-10-16T09:00:00Z", updatedAt: "2026-10-16T10:00:00Z",
});

const card = (id: string, name: string, extra: Partial<Schemas["AgentCard"]> = {}): Schemas["AgentCard"] => ({
  id, teamSlug: "transport", teamName: "Transportation", slug: name.toLowerCase().replace(/ /g, "-"), name, description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
  citationMode: "snippet_link", status: "active", audience: "all_authenticated", shortName: null, ...extra,
});

const models = [{ id: "mod1", key: "m", displayName: "Model", description: "", maxClassification: "sensitive", contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsVision: false, supportsReasoning: false, health: { status: "healthy" as const } }];

const routes = (current: Schemas["Agent"], extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("none", "owner"),
  "GET /v1/teams/registrar/agents/ag1": () => current,
  "GET /v1/teams/registrar/agents/ag1/versions": () => [version],
  "GET /v1/chat-models": () => models,
  "GET /v1/teams/registrar/kbs": () => [],
  ...extra,
});

beforeAll(() => {
  window.scrollTo = () => {};
});

describe("a router's editor", () => {
  it("has Routing instead of Knowledge, Tools and Answering, and lists the agents it can reach", async () => {
    mockApi(
      routes(agent({ router: true }), {
        "GET /v1/agents": () => [
          card("a2", "Parking help", { routable: true }),
          card("a3", "Housing help", { routable: true }),
          card("a4", "Quiet agent"), // did not opt in
          card("a5", "Other door", { routable: true, router: true }), // a router is never a target
          card("ag1", "Front door", { routable: true }), // itself
        ],
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Routing/ }, { timeout: scaled(5000) }));
    expect(screen.queryByRole("button", { name: /^Knowledge/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tools/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Answering/ })).toBeNull();
    const list = await screen.findByRole("region", { name: "Agents this router can reach" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Parking help · Transportation", "Housing help · Transportation"]);
    expect(within(list).getByText("It can reach 2 agents that you can chat with.", { exact: false })).toBeInTheDocument();
    // The wording starts as the standard router wording, not the knowledge-base refusal.
    expect((screen.getByRole("textbox", { name: "When nothing fits" }) as HTMLTextAreaElement).value).toMatch(/^I couldn't find an assistant here/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says so when no agent can be reached yet, and keeps a wording of its own", async () => {
    const calls = mockApi(
      routes(agent({ router: true, refusalMessage: "Try the help desk." }), {
        "GET /v1/agents": () => [card("a4", "Quiet agent")],
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ ...(b as { config: object }).config }),
      }),
    );
    renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Routing/ }, { timeout: scaled(5000) }));
    expect(await screen.findByText("No agent can be reached yet")).toBeInTheDocument();
    const wording = screen.getByRole("textbox", { name: "When nothing fits" });
    expect(wording).toHaveValue("Try the help desk.");
    await userEvent.type(wording, "!");
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: scaled(3000) });
    expect((calls.find((c) => c.method === "PATCH")!.body as { config: { refusalMessage: string } }).config.refusalMessage).toBe("Try the help desk.!");
  });

  it("an ordinary agent has no Routing section", async () => {
    mockApi(routes(agent({ kbs: [{ kbId: "kb1", topK: 6 }] })));
    renderApp("/teams/registrar/agents/ag1");
    expect(await screen.findByRole("button", { name: /^Knowledge/ }, { timeout: scaled(5000) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Routing/ })).toBeNull();
  });
});

describe("Share → Routers", () => {
  const sharing: Schemas["AgentSharing"] = {
    agentId: "ag1", audience: "team", draftAudience: "team", shortName: null, publicAgentsEnabled: true, classification: "open", maxAudience: "public",
    options: [{ audience: "team", allowed: true, reasons: [] }, { audience: "all_authenticated", allowed: true, reasons: [] }, { audience: "public", allowed: true, reasons: [] }],
    links: { team: "https://rag.example.edu/a/registrar/door", id: "https://rag.example.edu/a/id/ag1", short: null },
    widget: { scriptUrl: "https://rag.example.edu/widget.js", integrity: "", maxMessageChars: 2000 },
  };

  it("lets an editor turn on Can be reached through routers, as part of the draft", async () => {
    const calls = mockApi(
      routes(agent({ kbs: [{ kbId: "kb1", topK: 6 }] }), {
        "GET /v1/teams/registrar/agents/ag1/sharing": () => sharing,
        "PATCH /v1/teams/registrar/agents/ag1": (b) => agent({ ...(b as { config: object }).config }),
      }),
    );
    const { container } = renderApp("/teams/registrar/agents/ag1?tab=share");
    const toggle = await screen.findByRole("switch", { name: "Can be reached through routers" }, { timeout: scaled(5000) });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: scaled(3000) });
    expect((calls.find((c) => c.method === "PATCH")!.body as { config: { routable: boolean } }).config.routable).toBe(true);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is not offered to a router: it can't be reached through routers", async () => {
    mockApi(routes(agent({ router: true }), { "GET /v1/teams/registrar/agents/ag1/sharing": () => sharing }));
    renderApp("/teams/registrar/agents/ag1?tab=share");
    expect(await screen.findByRole("heading", { name: "Audience" }, { timeout: scaled(5000) })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Can be reached through routers" })).toBeNull();
  });
});
