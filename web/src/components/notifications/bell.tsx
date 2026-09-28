/*
 * The top-bar bell: the unread count (polled), and a popover with the latest
 * notifications, "Mark all as read", "View all" and the settings.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, BellOff, Settings } from "lucide-react";
import { useState } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Popover } from "@/components/ui/popover/popover";
import { Loading } from "@/components/ui/spinner/spinner";
import { badgeText, bellLabel, latestNotificationsQuery, useMarkAllRead } from "./api";
import { NotificationItem } from "./item";
import styles from "./notifications.module.css";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const latest = useQuery(latestNotificationsQuery());
  const markAll = useMarkAllRead();
  const unread = latest.data?.unreadCount;
  const items = latest.data?.items ?? [];
  const close = () => setOpen(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      title="Notifications"
      className={styles.popup}
      trigger={
        <Button variant="ghost" iconOnly aria-label={bellLabel(unread)} className={styles.bell}>
          <Bell aria-hidden />
          {!!unread && (
            <span className={styles.count} aria-hidden>
              {badgeText(unread)}
            </span>
          )}
        </Button>
      }
    >
      {latest.isLoading ? (
        <Loading label="Loading notifications…" />
      ) : latest.error ? (
        <ErrorAlert error={latest.error} title="Couldn't load notifications" />
      ) : items.length === 0 ? (
        <EmptyState size="compact" icon={<BellOff />} title="You're all caught up" description="Nothing new." />
      ) : (
        <ul className={styles.list} aria-label="Latest notifications">
          {items.map((n) => (
            <NotificationItem key={n.id} n={n} compact onOpen={close} />
          ))}
        </ul>
      )}
      <div className={styles.footer}>
        <Button variant="ghost" size="sm" disabled={!unread} loading={markAll.isPending} onClick={() => markAll.mutate(undefined)}>
          Mark all as read
        </Button>
        <span className={styles.footerLinks}>
          <Button variant="ghost" size="sm" iconOnly aria-label="Notification settings" render={<Link to="/settings/notifications" onClick={close} />}>
            <Settings aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" render={<Link to="/notifications" onClick={close} />}>
            View all
          </Button>
        </span>
      </div>
    </Popover>
  );
}
