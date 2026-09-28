/*
 * The moderation drill-down (docs/ui-review F-02): recent decisions with the
 * category that triggered, the score and whether an uncalibrated provider's
 * block only flagged. Content-free: no message text or people.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import type { Range } from "@/components/analytics/range-picker";
import { channelLabels } from "@/components/analytics/format";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { formatDate } from "@/lib/format";
import { categoryLabel } from "@/lib/moderation";
import s from "../../shared.module.css";

const decisionLabels: Record<string, string> = { block: "Blocked", flag: "Flagged", support: "Support", error: "Provider error" };

export function ModerationEvents({ range, filtered }: { range: Range; filtered?: boolean }) {
  const [open, setOpen] = useState(false);
  const events = useQuery({
    queryKey: ["admin", "analytics", "moderation-events", range.from, range.to],
    queryFn: async () => unwrap(await api.GET("/v1/admin/analytics/moderation-events", { params: { query: { from: range.from, to: range.to, limit: 50 } } })),
    enabled: open,
  });
  const items = events.data?.items ?? [];
  return (
    <Card title="Moderation decisions" description={`The latest 50 blocked, flagged and failed checks${filtered ? " of every team and audience" : ""}: which category triggered and how sure the provider was. No message text is kept.`}>
      <Disclosure title="Show decisions" open={open} onOpenChange={setOpen}>
        {events.isLoading ? (
          <Loading label="Loading decisions…" />
        ) : events.error ? (
          <ErrorAlert error={events.error} />
        ) : items.length === 0 ? (
          <EmptyState size="compact" title="No moderation decisions in this range." />
        ) : (
          <Table caption="Moderation decisions" columns={["When", "Agent", "Channel", "Stage", "Decision", "Category", { label: "Score", numeric: true }, "Provider"]}>
            {items.map((e) => (
              <Tr key={`${e.id}-${e.stage}`}>
                <Td muted nowrap>
                  {formatDate(e.at)}
                </Td>
                <Td>
                  {e.agentName || <span className={s.muted}>Deleted agent</span>}
                  <span className={s.secondary}>{e.teamSlug}</span>
                </Td>
                <Td>{channelLabels[e.channel as keyof typeof channelLabels] ?? e.channel}</Td>
                <Td>{e.stage === "input" ? "Question" : "Answer"}</Td>
                <Td>
                  {decisionLabels[e.decision] ?? e.decision}
                  {e.downgraded.length > 0 && <span className={s.secondary}>Block lowered to flag: provider not calibrated</span>}
                </Td>
                <Td>{e.decision === "error" ? "—" : categoryLabel(e.topCategory)}</Td>
                <Td numeric>{e.decision === "error" ? "—" : `${Math.round(e.score * 100)}%`}</Td>
                <Td>
                  {e.calibrated ? <Badge size="sm">Calibrated</Badge> : <Badge size="sm" tone="warning">Not calibrated</Badge>}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Disclosure>
    </Card>
  );
}
