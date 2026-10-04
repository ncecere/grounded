/*
 * A tool turn's text isn't the answer (v0.4.2 BU2-01): text the model streamed before it called a tool (narration, a
 * first draft) is taken back by text_reset, so the answer reads once, from the model's final turn.
 */
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});

const narration = "I'll check the outage tool. For your visitor, use EU-Guest [1].";
const answer = "The VPN is working [2]. For your visitor, use EU-Guest [1].";

/** The events of a streamed answer whose first turn wrote text, then called a tool. */
function stream(stopAt?: "reset" | "tool"): AssistantItem {
  let a = applyChatEvent(pendingAssistant(), "message_start", { messageId: "m1" });
  a = applyChatEvent(a, "retrieval", { query: "Is the VPN down?", hits: [{ n: 1, title: "Guest Wi-Fi", snippet: "EU-Guest" }] });
  for (const w of narration.split(/(?<= )/)) a = applyChatEvent(a, "text_delta", { delta: w });
  if (stopAt === "tool") return a;
  a = applyChatEvent(a, "text_reset", { reason: "tool_call" });
  if (stopAt === "reset") return a;
  a = applyChatEvent(a, "tool_call", { id: "c1", name: "check_outage", arguments: { service: "vpn" } });
  a = applyChatEvent(a, "retrieval", { query: "", hits: [{ n: 2, title: "Service status · check_outage", snippet: "Service vpn: operating normally.", kind: "tool" }] });
  a = applyChatEvent(a, "tool_result", { id: "c1", isError: false, hitCount: 1, result: "Service vpn: operating normally." });
  for (const w of answer.split(/(?<= )/)) a = applyChatEvent(a, "text_delta", { delta: w });
  return a;
}

describe("text_reset", () => {
  it("discards the text streamed so far, and keeps the steps and sources", () => {
    expect(stream("tool").text).toBe(narration);
    const reset = stream("reset");
    expect(reset.text).toBe("");
    expect(reset.steps).toHaveLength(1);
    expect(reset.sources).toHaveLength(1);
    const done = stream();
    expect(done.text).toBe(answer);
    expect(done.sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it("leaves a moderation notice alone", () => {
    let a = applyChatEvent(stream("tool"), "moderation", { stage: "output", action: "retracted", notice: "This answer was removed." });
    a = applyChatEvent(a, "text_reset", { reason: "tool_call" });
    expect(a.text).toBe("This answer was removed.");
  });

  it("shows the answer once while it streams and when it ends", async () => {
    const live = stream();
    const items: ChatItem[] = [{ role: "user", key: "u1", text: "Is the VPN down, and which Wi-Fi should my visitor use?" }, live];
    const { container, rerender } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    expect(await screen.findByText(/The VPN is working/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent("I'll check the outage tool");
    const end = applyChatEvent(applyChatEvent(live, "message_end", { messageId: "m1", stopReason: "stop", text: answer, citations: [] }), "done", {});
    rerender(<ChatMessages items={[items[0]!, end]} agent={{ name: "Helper" }} />);
    expect(container.textContent?.match(/For your visitor/g)).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});
