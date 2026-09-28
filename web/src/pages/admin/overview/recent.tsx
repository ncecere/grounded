/* Admin Overview › Recent changes (A1): the last 8 audit entries other than sign-ins, linking to Logs. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { actionLabel, actorName, targetTypeLabel } from "@/components/audit/labels";
import { RelativeTime } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item/item";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { recentChangesQuery } from "./queries";
import o from "./overview.module.css";

export function RecentChanges() {
  const q = useQuery(recentChangesQuery());
  const items = q.data?.items ?? [];
  return (
    <Card
      title="Recent changes"
      actions={
        <Button size="sm" variant="ghost" render={<Link to="/admin/logs" />}>
          All logs <ArrowRight aria-hidden />
        </Button>
      }
      flush={items.length > 0}
    >
      {q.isLoading ? (
        <div role="status" aria-label="Loading…">
          <SkeletonText lines={4} />
        </div>
      ) : q.error ? (
        <ErrorAlert error={q.error} title="Couldn't load recent changes" />
      ) : items.length === 0 ? (
        <p className={o.allClear}>No changes yet.</p>
      ) : (
        <ItemGroup className={o.queue}>
          {items.map((e) => (
            <Item key={e.id} size="xs" className={o.row} render={<Link to="/admin/logs" search={{ record: String(e.id) } as never} />}>
              <ItemContent>
                <ItemTitle>
                  {actionLabel(e.action)}
                  {e.targetLabel ? `: ${e.targetLabel}` : ""}
                </ItemTitle>
                <ItemDescription>
                  {actorName(e.actor)} · {targetTypeLabel(e.targetType)} · <RelativeTime value={e.occurredAt} />
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
    </Card>
  );
}
