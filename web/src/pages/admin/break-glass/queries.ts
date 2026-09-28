/* Admin → Break-glass: queries and mutations shared by the page's parts. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { type BreakGlassDetail, breakGlassKey } from "@/lib/break-glass";

export const settingsKey = [...breakGlassKey, "settings"];

export function useBreakGlassSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/settings/break-glass")) });
}

/** Pending and active sessions (refreshed every 30 s: approvals and ends by other admins). */
export function useOpenSessions() {
  return useQuery({
    queryKey: [...breakGlassKey, "list", "open"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/break-glass", { params: { query: { state: "open", limit: 200 } } })),
    refetchInterval: 30_000,
  });
}

/** Every session, newest first, a page at a time. */
export function useAllSessions() {
  return useInfiniteQuery({
    queryKey: [...breakGlassKey, "list", "all"],
    queryFn: async ({ pageParam }) => unwrap(await api.GET("/v1/admin/break-glass", { params: { query: { cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: [...breakGlassKey, "session", id],
    queryFn: async () => unwrap(await api.GET("/v1/admin/break-glass/{sessionId}", { params: { path: { sessionId: id! } } })),
    enabled: Boolean(id),
  });
}

export function useReads(id: string) {
  return useInfiniteQuery({
    queryKey: [...breakGlassKey, "reads", id],
    queryFn: async ({ pageParam }) =>
      unwrap(await api.GET("/v1/admin/break-glass/{sessionId}/reads", { params: { path: { sessionId: id }, query: { cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export type SessionAction = { kind: "approve" } | { kind: "end" } | { kind: "deny"; reason: string };

/** Approve, deny, end or withdraw a session; refreshes every break-glass query. */
export function useSessionAction(id: string, onDone?: (s: BreakGlassDetail) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: SessionAction) => {
      const p = { params: { path: { sessionId: id } } };
      if (a.kind === "approve") return unwrap(await api.POST("/v1/admin/break-glass/{sessionId}/approve", p));
      if (a.kind === "deny") return unwrap(await api.POST("/v1/admin/break-glass/{sessionId}/deny", { ...p, body: { reason: a.reason } }));
      return unwrap(await api.POST("/v1/admin/break-glass/{sessionId}/end", p));
    },
    onSuccess: (s) => onDone?.(s),
    onSettled: () => qc.invalidateQueries({ queryKey: breakGlassKey }),
  });
}
