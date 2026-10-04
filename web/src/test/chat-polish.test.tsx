/* Chat polish from the v0.4.2 bug hunt: the search step's title (US-09) and more. */
import { screen } from "@testing-library/react";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

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
