/*
 * Notification queries and mutations (docs/phase4-publishing.md §8). The bell
 * and the inbox poll every 60 s and refetch when the window regains focus.
 */
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";

export type Notification = Schemas["Notification"];
export type NotificationType = Schemas["NotificationType"];
export type NotificationSetting = Schemas["NotificationSetting"];

export const notificationsKey = ["notifications"];
export const notificationSettingsKey = ["notification-settings"];

/** How often the bell and the inbox check for new notifications. */
export const POLL_MS = 60_000;

/** How many items the bell's popover shows. */
export const LATEST = 6;

const polling = { refetchInterval: POLL_MS, refetchOnWindowFocus: true, refetchIntervalInBackground: false } as const;

/** The latest notifications and the unread count, for the bell. */
export const latestNotificationsQuery = () =>
  queryOptions({
    queryKey: [...notificationsKey, "latest"],
    queryFn: async () => unwrap(await api.GET("/v1/notifications", { params: { query: { limit: LATEST } } })),
    ...polling,
  });

export type InboxFilter = { unread: boolean; type?: NotificationType };

/** The inbox, newest first, a page at a time. */
export const inboxQuery = (f: InboxFilter) =>
  infiniteQueryOptions({
    queryKey: [...notificationsKey, "inbox", f.unread ? "unread" : "all", f.type ?? "any"],
    queryFn: async ({ pageParam }) =>
      unwrap(await api.GET("/v1/notifications", { params: { query: { unread: f.unread || undefined, type: f.type, cursor: pageParam, limit: 25 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...polling,
  });

/** Marks one notification read or unread. */
export function useSetRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, read }: { id: string; read: boolean }) =>
      unwrap(await api.PATCH("/v1/notifications/{notificationId}", { params: { path: { notificationId: id } }, body: { read } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}

/** Marks every unread notification read (optionally of one type). */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (type?: NotificationType) => unwrap(await api.POST("/v1/notifications/read-all", { body: type ? { type } : {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}

export const notificationSettingsQuery = () =>
  queryOptions({
    queryKey: notificationSettingsKey,
    queryFn: async () => unwrap(await api.GET("/v1/me/notification-settings")),
  });

/** Saves one event type's channels. */
export function useSaveNotificationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: { type: NotificationType; inApp: boolean; email: boolean }) =>
      unwrap(await api.PUT("/v1/me/notification-settings", { body: { items: [item] } })),
    onSuccess: (data) => qc.setQueryData(notificationSettingsKey, data),
  });
}

/** "5 min ago", "yesterday", or a date for older items. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** The bell's accessible name, e.g. "Notifications, 3 unread". */
export function bellLabel(unread: number | undefined): string {
  return unread === undefined ? "Notifications" : `Notifications, ${unread} unread`;
}

/** The visible badge text: the count, capped at 99+. */
export function badgeText(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}
