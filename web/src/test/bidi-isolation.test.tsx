/* User-controlled text inside interface sentences is bidi-isolated (QA v0.6.0, #126): a right-to-left override (U+202E) in a title or a question must not rearrange the words around it. */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderApp, shellRoutes, sse } from "./harness";

const RLO = "\u202e";
const evil = `Fees${RLO}dne`;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

/** The `<bdi>` that holds `text` (an element that isolates it), or null. */
const isolated = (root: HTMLElement, text: string) => [...root.querySelectorAll("bdi")].find((b) => b.textContent === text) ?? null;

const card = {
  id: "ag1", teamSlug: "registrar", teamName: "Office of the Registrar", slug: "registrar-assistant", name: "Registrar assistant", description: "",
  accentColor: "", welcomeMessage: "", starterQuestions: [], citationMode: "snippet_link", status: "active", audience: "all_authenticated",
};
const conv = { id: "c1", agentId: "ag1", agentName: "Registrar assistant", agentSlug: "registrar-assistant", teamSlug: "registrar", agentDeleted: false, title: evil, createdAt: "2026-10-16T09:00:00Z", updatedAt: "2026-10-16T09:30:00Z" };
const routes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  ...shellRoutes(),
  "GET /v1/agents/registrar/registrar-assistant": () => card,
  "GET /v1/agents": () => [card],
  "GET /v1/conversations": () => ({ items: [conv], nextCursor: null }),
  "GET /v1/conversations/c1/shares": () => [],
  ...extra,
});

describe("conversation titles and questions", () => {
  it("isolates a title in the chat's list, in the Share dialog's sentence and in the delete question", async () => {
    mockApi(routes());
    renderApp("/a/registrar/registrar-assistant");
    const list = await screen.findByRole("navigation", { name: "Conversations with Registrar assistant" });
    expect(isolated(await within(list).findByRole("link", { name: new RegExp(evil) }), evil)).not.toBeNull();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Actions for ${evil}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Share…" }));
    const dialog = await screen.findByRole("dialog", { name: "Share this conversation" });
    expect(isolated(dialog, evil)).not.toBeNull();
    expect(isolated(dialog, "Registrar assistant")).not.toBeNull();
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: `Actions for ${evil}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    expect(isolated(await screen.findByRole("alertdialog"), evil)).not.toBeNull();
  });

  it("isolates a title on the Conversations page", async () => {
    mockApi(routes());
    renderApp("/conversations");
    // The page's own list (the app sidebar lists recent conversations too).
    const link = await within(await screen.findByRole("main")).findByRole("link", { name: new RegExp(`${evil}.*Registrar assistant`) });
    expect(isolated(link, evil)).not.toBeNull();
  });

  it("isolates the question in the retrieval header", async () => {
    const usage = { input: 9, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10 };
    const question = `Where is the ${RLO}fee page`;
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () =>
          sse([
            ["conversation", { conversationId: "c2", userMessageId: "um1", agentVersion: 1 }],
            ["retrieval", { query: question, hits: [{ n: 1, title: "Fees", snippet: "…" }] }],
            ["message_start", { messageId: "m1" }],
            ["message_end", { messageId: "m1", stopReason: "stop", text: "Ok.", citations: [], usage, refused: false, noContext: false }],
            ["done", {}],
          ]),
      }),
    );
    renderApp("/a/registrar/registrar-assistant");
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    fireEvent.change(box, { target: { value: question } });
    await userEvent.click(screen.getByRole("button", { name: /send|submit/i }));
    const header = await screen.findByRole("button", { name: /Searched the knowledge base for/ });
    expect(isolated(header, question)).not.toBeNull();
  });
});

describe("a shared page", () => {
  it("isolates the title, the agent and who shared it", async () => {
    const view = {
      title: evil,
      agent: { name: `Help${RLO}`, slug: "registrar-assistant", teamSlug: "registrar", description: "", accentColor: "" },
      sharedBy: `Blair${RLO}`,
      sharedAt: "2026-10-16T09:40:00Z",
      audience: "agent_users",
      owner: false,
      messages: [{ id: "m1", seq: 1, role: "user", text: "Hi", citations: [], createdAt: "2026-10-16T09:30:00Z" }],
    };
    mockApi({ ...shellRoutes(), "GET /v1/shared/tok": () => view });
    renderApp("/shared/tok");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(isolated(heading, evil)).not.toBeNull();
    const meta = heading.parentElement!;
    expect(isolated(meta, `Help${RLO}`)).not.toBeNull();
    expect(isolated(meta, `Blair${RLO}`)).not.toBeNull();
    expect(within(meta).getByText(/shared by/)).toBeInTheDocument();
  });
});
