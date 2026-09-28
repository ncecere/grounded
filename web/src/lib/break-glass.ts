/*
 * Break-glass (ADR-0024, docs/phase5-deploy.md §5 P4): a platform admin's
 * time-boxed, audited read access to one team's conversations and
 * documents. The shell shows the reading admin a banner with the time left;
 * the team's pages open for them within the session's scope; owners see a
 * notice. Every read is recorded on the server.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap, type Schemas } from "../api/client";

export type BreakGlassSession = Schemas["BreakGlassSession"];
export type BreakGlassDetail = Schemas["BreakGlassSessionDetail"];
export type BreakGlassScope = Schemas["BreakGlassScope"];
export type BreakGlassStatus = Schemas["BreakGlassStatus"];
export type BreakGlassReadKind = Schemas["BreakGlassReadKind"];

/** Every break-glass query starts with this key (invalidate it after a change). */
export const breakGlassKey = ["break-glass"];

/** The caller's open sessions (GET /v1/me/break-glass), polled so the banner stays current. */
export const myBreakGlassQuery = () =>
  queryOptions({
    queryKey: [...breakGlassKey, "mine"],
    queryFn: async () => unwrap(await api.GET("/v1/me/break-glass")),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

/** The caller's open sessions; [] for everyone but platform admins (`enabled` false). */
export function useMyBreakGlass(enabled: boolean): BreakGlassSession[] {
  const q = useQuery({ ...myBreakGlassQuery(), enabled });
  return enabled ? (q.data ?? []) : [];
}

/** The current time, updated every `ms` (for countdowns). */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Active and not yet past its end at `now`. */
export const isLive = (s: BreakGlassSession, now = Date.now()) => s.status === "active" && Boolean(s.expiresAt) && new Date(s.expiresAt!).getTime() > now;

/** The caller's live session on a team (by slug), optionally with a scope. */
export function liveGrant(sessions: BreakGlassSession[], team: string, scope?: BreakGlassScope, now = Date.now()) {
  return sessions.find((s) => s.team.slug === team && isLive(s, now) && (!scope || s.scopes.includes(scope)));
}

export const scopeLabels: Record<BreakGlassScope, string> = { conversations: "Conversations", documents: "Documents" };

/** "conversations", "documents" or "conversations and documents". */
export const scopeWords = (scopes: BreakGlassScope[]) => scopes.map((s) => s.toLowerCase()).join(" and ");

export const statusLabels: Record<BreakGlassStatus, string> = {
  pending: "Waiting for approval",
  active: "Active",
  ended: "Ended",
  expired: "Expired",
  denied: "Denied",
  cancelled: "Withdrawn",
  request_expired: "Not approved in time",
};

export const statusTone: Record<BreakGlassStatus, "warning" | "danger" | "neutral" | "info"> = {
  pending: "info",
  active: "warning",
  ended: "neutral",
  expired: "neutral",
  denied: "danger",
  cancelled: "neutral",
  request_expired: "neutral",
};

export const readKindLabels: Record<BreakGlassReadKind, string> = {
  conversation_list: "Conversation list",
  conversation: "Conversation transcript",
  source_list: "Data source list",
  source: "Data source",
  document_list: "Document list",
  document: "Document",
  passages: "Document passages",
  tags: "Document tags",
  crawls: "Crawl history",
  boilerplate: "Repeated blocks",
};

/** "42 minutes left", "1 h 5 min left", "Less than a minute left". */
export function timeLeft(expiresAt: string, now = Date.now()) {
  const mins = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  if (mins < 1) return "Less than a minute left";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h${m ? ` ${m} min` : ""} left`;
}

/** "1 hour", "90 minutes", "8 hours". */
export function durationText(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

/** Who a person reference is. */
export const personName = (p: { displayName: string; email: string } | null | undefined) => (p ? p.displayName || p.email : "—");
