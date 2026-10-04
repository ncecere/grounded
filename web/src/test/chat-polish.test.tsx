/* Chat polish from the v0.4.2 bug hunt: the search step's title (US-09), taking a rating back (US-11), Discover's filter chips (US-13). */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { axe } from "vitest-axe";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";

const answered = (query: string, question: string): ChatItem[] => {
  let a: AssistantItem = applyChatEvent(pendingAssistant(), "retrieval", { query, hits: [{ n: 1, title: "Wi-Fi", snippet: "…" }] });
  a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Three networks [1].", citations: [], refused: false, noContext: false });
  return [{ role: "user", key: "u1", text: question }, applyChatEvent(a, "done", {})];
};

describe("the search step (US-09)", () => {
  it("shows a follow-up searched with the earlier question as the question, not the two run together", async () => {
    renderBare(<ChatMessages items={answered("How do I connect to eduroam? Which networks are available on campus?", "Which networks are available on campus?")} agent={{ name: "Helper" }} />);
    expect(await screen.findByText("Searched the knowledge base for “Which networks are available on campus?” with your earlier question")).toBeInTheDocument();
  });

  it("shows a rewritten or plain query as it was searched", async () => {
    renderBare(<ChatMessages items={answered("campus wifi networks", "Which networks are available?")} agent={{ name: "Helper" }} />);
    expect(await screen.findByText("Searched the knowledge base for “campus wifi networks”")).toBeInTheDocument();
  });
});

describe("feedback (US-11)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a pressed Good answer takes the rating back, said to screen readers, without a toast", async () => {
    const calls = mockApi({ "POST /v1/messages/m1/feedback": (b) => ({ messageId: "m1", shared: false, ...(b as object) }) });
    const [user, a] = answered("wifi", "Which networks?");
    const rated = { ...(a as AssistantItem), id: "m1", feedback: { rating: "up" as const } };
    function Thread() {
      const [item, setItem] = useState<AssistantItem>(rated);
      return <ChatMessages items={[user!, item]} agent={{ name: "Helper" }} feedback onPatch={(_k, fn) => setItem(fn)} />;
    }
    renderBare(<Thread />);
    const good = await screen.findByRole("button", { name: "Good answer" });
    expect(good).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(good);
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/messages/m1/feedback")?.body).toEqual({ rating: "none" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByText("Thanks for the feedback")).toBeNull();
  });
});

describe("Discover's filters (US-13)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const card = (id: string, name: string, teamSlug: string, teamName: string) => ({
    id, name, slug: id, teamSlug, teamName, description: "", accentColor: "#0021a5", welcomeMessage: "", starterQuestions: [],
    citationMode: "snippet_link", status: "active", audience: "team", group: "team",
  });

  it("shows the search as a chip, and Clear all clears it with the team", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [card("a1", "Help Desk Assistant", "it", "IT Help Desk"), card("a2", "Library Guide", "library", "Library")] });
    const { router, container } = renderApp("/agents?q=wifi&team=it");
    const chips = await screen.findByRole("list", { name: "Active filters" });
    expect(screen.getByRole("button", { name: "Remove search filter: “wifi”" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Remove team filter: IT Help Desk" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(chips).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  });
});
