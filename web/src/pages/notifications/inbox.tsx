/*
 * The inbox (/notifications): all or unread, filtered by type (?type=),
 * newest first, with "Mark all as read" while something is unread (Q5).
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, CheckCheck, Settings } from "lucide-react";
import { PageTabs, useUrlTab } from "../../components/page-tabs";
import { LoadMore, QueryView } from "../../components/query-view";
import { inboxQuery, notificationSettingsQuery, type NotificationType, useMarkAllRead } from "../../components/notifications/api";
import { NotificationItem } from "../../components/notifications/item";
import { notificationTabs } from "../../lib/tabs";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Select, type SelectItem } from "@/components/ui/select/select";
import { cx } from "@/lib/bitop-utils";
import { useSearchParams } from "@/lib/url-search";
import s from "../shared.module.css";
import n from "../../components/notifications/notifications.module.css";
import styles from "./notifications.module.css";

const anyType = "any";
type TypeFilter = NotificationType | typeof anyType;

export function NotificationsPage() {
  const [tab, setTab] = useUrlTab(notificationTabs);
  const [params, setParams] = useSearchParams();
  const type = (params.get("type") as TypeFilter | null) ?? anyType;
  const setType = (next: TypeFilter) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (next === anyType) out.delete("type");
      else out.set("type", next);
      return out;
    });
  const settings = useQuery(notificationSettingsQuery());
  const markAll = useMarkAllRead();
  const typeItems: SelectItem<TypeFilter>[] = [
    { value: anyType, label: "All types" },
    ...(settings.data?.items ?? []).map((i) => ({ value: i.type, label: i.label })),
  ];
  const filter = { type: type === anyType ? undefined : type };
  // The Unread tab's first page (shared cache): nothing unread, nothing to mark.
  const unread = useInfiniteQuery(inboxQuery({ unread: true, type: filter.type }));
  const hasUnread = (unread.data?.pages[0]?.items.length ?? 0) > 0;
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Notifications"
        description="Invites, changes to your teams, and problems with your sources and agents."
        actions={
          <>
            <Button variant="secondary" render={<Link to="/settings/notifications" />}>
              <Settings aria-hidden /> Settings
            </Button>
            {hasUnread && (
              <Button loading={markAll.isPending} onClick={() => markAll.mutate(filter.type)}>
                <CheckCheck aria-hidden /> {filter.type ? "Mark these as read" : "Mark all as read"}
              </Button>
            )}
          </>
        }
      />
      <div className={styles.filters}>
        <Select<TypeFilter>
          label="Type"
          items={typeItems}
          value={type}
          onValueChange={(v) => setType(v ?? anyType)}
          className={styles.type}
        />
      </div>
      <PageTabs
        label="Show"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "all", label: "All", content: <Inbox unread={false} type={filter.type} /> },
          { value: "unread", label: "Unread", content: <Inbox unread type={filter.type} /> },
        ]}
      />
    </Stack>
  );
}

function Inbox({ unread, type }: { unread: boolean; type?: NotificationType }) {
  const q = useInfiniteQuery(inboxQuery({ unread, type }));
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const empty = (
    <EmptyState
      icon={<BellOff />}
      title={unread ? "No unread notifications" : "No notifications yet"}
      description={type ? "Nothing of this type." : unread ? "You're all caught up." : "You'll see invites and updates about your teams here."}
    />
  );
  return (
    <Card flush>
      <QueryView query={q} loadingLabel="Loading notifications…" empty={items.length === 0 && empty}>
        <ul className={cx(n.list, styles.list)} aria-label={unread ? "Unread notifications" : "Notifications"}>
          {items.map((item) => (
            <NotificationItem key={item.id} n={item} />
          ))}
        </ul>
        <LoadMore query={q} />
      </QueryView>
    </Card>
  );
}
