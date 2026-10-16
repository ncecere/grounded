/* A shared conversation (v0.6.0, C12): the view by its link's secret, and its messages as the chat thread draws them. */
import type { Schemas } from "@/api/client";
import { api, unwrap } from "@/api/client";
import type { ChatItem, Citation } from "../chat/stream";

export type SharedConversation = Schemas["SharedConversation"];
type SharedMessage = Schemas["SharedMessage"];
type SharedCitation = Schemas["SharedCitation"];

/** The view for a link's secret. `viewer` names who is looking (a person, or no one) so signing in loads it again. */
export const sharedQuery = (token: string, viewer: string) => ({
  queryKey: ["shared", token, viewer],
  queryFn: async () => unwrap(await api.GET("/v1/shared/{token}", { params: { path: { token } } })),
  retry: false,
  staleTime: 0,
});

// The thread's sources carry the passage's document and source for the team's editors; a shared view has neither, and nothing opens by them.
const NONE = "00000000-0000-0000-0000-000000000000";

const citationOf = (c: SharedCitation): Citation => ({
  n: c.n,
  documentId: NONE,
  sourceId: NONE,
  title: c.title,
  snippet: c.snippet ?? "",
  headingPath: c.headingPath,
  pageStart: c.pageStart,
  pageEnd: c.pageEnd,
  url: c.url,
  kind: c.kind as Citation["kind"],
  server: c.server,
  tool: c.tool,
  truncated: c.truncated,
});

/** A moderation notice is stored as the answer's text with an error code; it reads as the answer, as it did to the person who asked. */
const isNotice = (code?: string) => code?.startsWith("moderation_") === true;

/** The shared messages as chat items: questions and answers with their citations, nothing the agent did to get there. */
export function itemsFromShared(messages: SharedMessage[]): ChatItem[] {
  return messages.map((m): ChatItem => {
    if (m.role === "user") return { role: "user", key: m.id, id: m.id, text: m.text };
    const failed = Boolean(m.errorCode) && !isNotice(m.errorCode);
    return {
      role: "assistant",
      key: m.id,
      id: m.id,
      text: m.text,
      thinking: "",
      steps: [],
      sources: [],
      citations: m.citations.map(citationOf),
      status: m.stopped ? "aborted" : failed ? "error" : "done",
      stopReason: m.stopped ? "aborted" : undefined,
      error: failed ? { code: m.errorCode!, message: "" } : undefined,
      restored: true,
    };
  });
}
