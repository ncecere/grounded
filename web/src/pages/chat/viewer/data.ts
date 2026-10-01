/*
 * What the source viewer shows (docs/v0.4.0.md §5), loaded the way each chat
 * may: a stored answer's cited passage through its message (the asker's own
 * conversation, or an anonymous session's), and in Try it and the widget
 * preview (nothing stored, editors only) through the team's document text
 * around the cited passage.
 */
import { createContext, useContext } from "react";
import { ApiError, api, unwrap, type Schemas } from "@/api/client";
import type { AssistantItem, Citation } from "../stream";

export type ContextPassage = Schemas["ContextPassage"];
export type DocumentText = Schemas["DocumentText"];

/** How a chat reads its answers' cited passages. */
export type ViewerAccess = { kind: "message" } | { kind: "public"; agentId: string } | { kind: "team"; team: string };

/** A source of an answer to show. */
export type ViewerTarget = { item: AssistantItem; n: number };

export type ViewerContextValue = {
  access: ViewerAccess;
  target?: ViewerTarget;
  open: (target: ViewerTarget) => void;
  close: () => void;
};

export const ViewerContext = createContext<ViewerContextValue | null>(null);

/** The chat's source viewer, or null where there is none (a transcript, an evaluation run). */
export const useSourceViewer = () => useContext(ViewerContext);

/** available: the passage in context; snippet: only what the answer quoted can be shown (it wasn't stored). */
export type ViewerStatus = Schemas["CitedPassage"]["status"] | "snippet";

/** The viewer's content, whichever way it was loaded. */
export type ViewerData = {
  status: ViewerStatus;
  passages: ContextPassage[];
  headingPath: string[];
  claims?: Schemas["Claim"][];
  /** The source's team, when the reader may open the whole document. */
  documentTeam?: string;
};

const fromCited = (p: Schemas["CitedPassage"]): ViewerData => ({
  status: p.status,
  passages: p.passages,
  headingPath: p.headingPath,
  claims: p.claims,
  documentTeam: p.documentTeam,
});

const snippetOnly = (c: Citation): ViewerData => ({ status: "snippet", passages: [], headingPath: c.headingPath });

/** The document text endpoint's path. */
export const documentTextPath = (team: string, c: Pick<Citation, "sourceId" | "documentId">) =>
  `/v1/teams/${encodeURIComponent(team)}/sources/${c.sourceId}/documents/${c.documentId}/text`;

async function aroundPassage(team: string, c: Citation): Promise<ViewerData> {
  try {
    const t = unwrap(
      await api.GET("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/text", {
        params: { path: { team, sourceId: c.sourceId, documentId: c.documentId }, query: { around: c.chunkId } },
      }),
    );
    const cited = t.items.find((p) => p.cited);
    return { status: "available", passages: t.items, headingPath: cited?.headingPath ?? c.headingPath, documentTeam: team };
  } catch (e) {
    if (e instanceof ApiError && e.code === "passage_not_found") return { status: "passage_changed", passages: [], headingPath: c.headingPath };
    if (e instanceof ApiError && e.code === "document_not_found") return { status: "document_deleted", passages: [], headingPath: c.headingPath };
    throw e;
  }
}

/** Loads source n of an answer for the viewer. */
export async function loadViewer(access: ViewerAccess, item: AssistantItem, c: Citation): Promise<ViewerData> {
  if (access.kind === "team") return c.chunkId ? aroundPassage(access.team, c) : snippetOnly(c);
  if (!item.id || item.status === "streaming") return snippetOnly(c);
  const path = { messageId: item.id, n: c.n };
  if (access.kind === "public") {
    return fromCited(unwrap(await api.GET("/v1/public/agents/{agentId}/messages/{messageId}/sources/{n}", { params: { path: { ...path, agentId: access.agentId } } })));
  }
  return fromCited(unwrap(await api.GET("/v1/messages/{messageId}/sources/{n}", { params: { path } })));
}

/** A page of the whole document (editors): limit passages from ordinal from. */
export async function loadDocumentPage(team: string, c: Pick<Citation, "sourceId" | "documentId">, from: number, limit: number): Promise<DocumentText> {
  return unwrap(
    await api.GET("/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/text", {
      params: { path: { team, sourceId: c.sourceId, documentId: c.documentId }, query: { from, limit } },
    }),
  );
}
