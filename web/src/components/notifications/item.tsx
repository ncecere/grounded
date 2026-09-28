/* One notification: title (a link to what it's about), body, time, and a read/unread toggle. */
import { useNavigate } from "@tanstack/react-router";
import { Check, Undo2 } from "lucide-react";
import type { MouseEvent } from "react";
import { formatDate } from "../../lib/format";
import { IconButton } from "@/components/ui/button/button";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { type Notification, timeAgo, useSetRead } from "./api";
import styles from "./notifications.module.css";

type Props = {
  n: Notification;
  /** Popover rows clamp the body to two lines. */
  compact?: boolean;
  /** Called after the link is followed (e.g. to close the popover). */
  onOpen?: () => void;
};

export function NotificationItem({ n, compact, onOpen }: Props) {
  const navigate = useNavigate();
  const setRead = useSetRead();
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab and new-window clicks.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!n.read) setRead.mutate({ id: n.id, read: true });
    onOpen?.();
    void navigate({ href: n.link });
  };
  const title = (
    <>
      {!n.read && <VisuallyHidden>Unread:</VisuallyHidden>} {n.title}
    </>
  );
  return (
    <li className={styles.item} data-unread={n.read ? undefined : ""}>
      <span className={styles.dot} aria-hidden />
      <div className={styles.text}>
        {n.link ? (
          <a href={n.link} className={styles.title} onClick={open}>
            {title}
          </a>
        ) : (
          <span className={styles.title}>{title}</span>
        )}
        {n.body && (
          <p className={styles.body} data-compact={compact ? "" : undefined}>
            {n.body}
          </p>
        )}
        <time className={styles.time} dateTime={n.createdAt} title={formatDate(n.createdAt)}>
          {timeAgo(n.createdAt)}
        </time>
      </div>
      <IconButton
        size="sm"
        icon={n.read ? <Undo2 aria-hidden /> : <Check aria-hidden />}
        label={n.read ? `Mark as unread: ${n.title}` : `Mark as read: ${n.title}`}
        loading={setRead.isPending}
        onClick={() => setRead.mutate({ id: n.id, read: !n.read })}
        className={styles.toggle}
      />
    </li>
  );
}
