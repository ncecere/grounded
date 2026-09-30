/*
 * An answer's steps (docs/mcp-client.md): an MCP tool's step shows the arguments the model sent and what the tool
 * returned; a call that failed or wasn't made says why; and a reloaded answer shows the search it ran before the
 * model (retrieval mode always) as well as its tool calls.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type AssistantItem, type ChatItem, applyChatEvent, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});

const toolHit = { n: 1, title: "Service status · check_outage", snippet: "Service email: operating normally.", kind: "tool", server: "Service status", tool: "check_outage" };

function live(): ChatItem[] {
  let a: AssistantItem = applyChatEvent(pendingAssistant(), "retrieval", { query: "Is email down?", hits: [] });
  a = applyChatEvent(a, "tool_call", { id: "c1", name: "check_outage", arguments: '{"service":"email"}' });
  a = applyChatEvent(a, "retrieval", { query: "", hits: [toolHit] });
  a = applyChatEvent(a, "tool_result", { id: "c1", isError: false, hitCount: 1, result: "Service email: operating normally." });
  a = applyChatEvent(a, "tool_call", { id: "c2", name: "check_outage", arguments: { service: "zoom" } });
  a = applyChatEvent(a, "tool_result", { id: "c2", isError: true, hitCount: 0, error: "Not called: this answer reached its limit of 1 tool calls." });
  a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Email is working.", citations: [], refused: false, noContext: false });
  return [{ role: "user", key: "u1", text: "Is email down?" }, applyChatEvent(a, "done", {})];
}

describe("an MCP tool's step", () => {
  it("shows the arguments sent and the result, not a query", async () => {
    const { container } = renderBare(<ChatMessages items={live()} agent={{ name: "Helper" }} />);
    const steps = await screen.findAllByRole("button", { name: /Used check_outage/ });
    expect(steps).toHaveLength(2);
    await userEvent.click(steps[0]!);
    const panel = steps[0]!.parentElement!;
    expect(panel).toHaveTextContent('"service": "email"');
    expect(panel).not.toHaveTextContent('"query"');
    expect(within(panel).getByText("Result")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Service email: operating normally.");
    expect(steps[0]).toHaveAccessibleName(/1 source/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says why a call wasn't made, instead of \"The search failed.\"", async () => {
    renderBare(<ChatMessages items={live()} agent={{ name: "Helper" }} />);
    const refused = (await screen.findAllByRole("button", { name: /Used check_outage/ }))[1]!;
    expect(refused).toHaveAccessibleName(/Error.*Not called: this answer reached its limit of 1 tool calls\./);
    await userEvent.click(refused);
    const panel = refused.parentElement!;
    expect(panel).toHaveTextContent('"service": "zoom"');
    expect(panel).not.toHaveTextContent("The search failed.");
    expect(panel).not.toHaveTextContent("0 results");
  });

  it("shows a tool's own error message after the reason", async () => {
    let a: AssistantItem = applyChatEvent(pendingAssistant(), "tool_call", { id: "c1", name: "check_outage", arguments: {} });
    a = applyChatEvent(a, "tool_result", { id: "c1", isError: true, hitCount: 0, error: "The tool reported an error.", result: "Unknown service." });
    a = applyChatEvent(applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Sorry.", citations: [] }), "done", {});
    renderBare(<ChatMessages items={[{ role: "user", key: "u1", text: "?" }, a]} agent={{ name: "Helper" }} />);
    const step = await screen.findByRole("button", { name: /Used check_outage/ });
    await userEvent.click(step);
    expect(step.parentElement).toHaveTextContent("The tool reported an error. Its message: Unknown service.");
  });
});

describe("a reloaded answer", () => {
  const message: Schemas["ConversationMessage"] = {
    id: "m1", seq: 2, role: "assistant", text: "Email is working.", createdAt: "2026-09-30T10:00:00Z",
    retrieval: { query: "Is email down?", hitCount: 3, judging: { judged: 8, kept: 3, dropped: 5 } },
    toolCalls: [
      { id: "c1", name: "check_outage", arguments: { service: "email" }, isError: false, hitCount: 1, result: "Service email: operating normally." },
      { id: "c2", name: "check_outage", arguments: { service: "zoom" }, isError: true, hitCount: 0, error: "Not called: the team's budget is used up." },
    ],
  };

  it("keeps the search before the model, then the tool calls with their arguments and outcomes", () => {
    const [item] = itemsFromConversation([message]) as AssistantItem[];
    expect(item!.steps.map((s) => [s.kind, s.name ?? s.query])).toEqual([
      ["retrieval", "Is email down?"],
      ["tool", "check_outage"],
      ["tool", "check_outage"],
    ]);
    expect(item!.steps[0]).toMatchObject({ hitCount: 3, judging: { judged: 8, kept: 3, dropped: 5 } });
    expect(item!.steps[1]).toMatchObject({ args: { service: "email" }, result: "Service email: operating normally." });
    expect(item!.steps[2]).toMatchObject({ isError: true, error: "Not called: the team's budget is used up." });
  });

  it("shows the \"Searched the knowledge base\" step", async () => {
    const items = itemsFromConversation([{ id: "u1", seq: 1, role: "user", text: "Is email down?", createdAt: "2026-09-30T10:00:00Z" }, message]);
    const { container } = renderBare(<ChatMessages items={items} agent={{ name: "Helper" }} />);
    expect(await screen.findByRole("button", { name: /Searched the knowledge base for “Is email down\?”/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Error.*the team's budget is used up/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reads a search_knowledge call as a search, as before", () => {
    const [item] = itemsFromConversation([
      { ...message, retrieval: undefined, toolCalls: [{ id: "s1", name: "search_knowledge", arguments: '{"query":"email"}', isError: false, hitCount: 2 }] },
    ]) as AssistantItem[];
    expect(item!.steps).toEqual([{ kind: "tool", id: "s1", query: "email", hitCount: 2, isError: false, error: undefined, result: undefined }]);
  });
});
