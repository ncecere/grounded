/*
 * A knowledge base's Sources tab (W4): the attached sources (documents, last
 * sync, a "…" menu with Detach). "Attach source" is the page's primary
 * action (C13; attach-flow.tsx): a dialog listing every source, the ones that
 * can't be attached disabled with their reason (embedding profile,
 * classification).
 */
import { Stack } from "@/components/ui/layout/layout";
import { Link } from "@tanstack/react-router";
import { Database, Unlink } from "lucide-react";
import { useState } from "react";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { impactSummary } from "../../sources/impact";
import { ClassificationBadge, type KB, plural, useClassificationLevels, useTeam } from "../common";
import type { AttachFlow } from "./attach-flow";
import { DetachConfirm, useLiveAgentsUsing } from "./detach-confirm";

type Attached = KB["sources"][number];

/** The Sources tab; attaching goes through the page's flow (the header's "Attach source"). */
export function KBSources({ kb, flow }: { kb: KB; flow: AttachFlow }) {
  const { slug, canEdit } = useTeam();
  const levels = useClassificationLevels();
  const { all, sourceName, attachImpact } = flow;
  const { attach, detach } = flow.mutations;
  const liveAgents = useLiveAgentsUsing(slug, kb.id);
  const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);
  const requestDetach = (src: { id: string; name: string }) => (liveAgents.length > 0 ? setConfirming(src) : detach.mutate(src.id));

  const columns: DataTableColumn<Attached>[] = [
    {
      id: "name",
      header: "Source",
      rowHeader: true,
      accessor: "name",
      cell: (src) =>
        src.shared ? (
          <CellText
            primary={
              <span className={s.badges}>
                <span className={s.primary}>{src.name}</span>
                <Badge tone="info" size="sm">
                  Shared
                </Badge>
              </span>
            }
            secondary="Managed by platform admins for every team"
          />
        ) : (
          <TextLink render={<Link to="/teams/$team/sources/$sourceId" params={{ team: slug, sourceId: src.id }} />} className={s.primary}>
            {src.name}
          </TextLink>
        ),
    },
    { id: "classification", header: "Classification", cell: (src) => <ClassificationBadge levels={levels.data} value={src.classification} /> },
    {
      id: "documents",
      header: "Documents",
      numeric: true,
      cell: (src) => {
        const full = all.find((x) => x.id === src.id);
        return full ? plural(full.documents.ready, "ready document") : "—";
      },
    },
    {
      id: "sync",
      header: "Last sync",
      cell: (src) => {
        const full = all.find((x) => x.id === src.id);
        if (!full || full.type !== "web") return <span className={s.muted}>—</span>;
        const last = (full as { lastSyncAt?: string | null }).lastSyncAt;
        return last ? <RelativeTime value={last} /> : src.shared ? <span className={s.muted}>—</span> : "Not synced yet";
      },
    },
  ];

  return (
    <Card title="Data sources" description="The sources this knowledge base searches. They must all use its embedding profile.">
      <Stack gap={4}>
        {detach.error && !confirming ? <ErrorAlert error={detach.error} /> : null}
        {attachImpact && (
          <div>
            <Alert
              tone="warning"
              title={`${sourceName(attach.variables ?? "")} wasn't attached`}
              actions={
                <Button size="sm" variant="secondary" onClick={() => flow.showImpact(attachImpact)}>
                  Show which agents
                </Button>
              }
            >
              It would raise this knowledge base's classification, and {impactSummary(attachImpact)} using it can't serve that level.
            </Alert>
          </div>
        )}
        <ListPage<Attached>
          id="kb-sources"
          caption="Attached data sources"
          columns={columns}
          data={kb.sources}
          getRowId={(src) => src.id}
          rowLabel={(src) => src.name}
          rowActions={(src) => [{ label: "Detach", icon: <Unlink aria-hidden />, danger: true, onSelect: () => requestDetach(src), hidden: !canEdit }]}
          empty={{
            icon: <Database />,
            title: "No data sources attached yet.",
            // The header's Attach source isn't repeated here (one primary per view).
            description: canEdit ? "Use Attach source above to choose the sources it searches." : undefined,
          }}
        />
      </Stack>
      <DetachConfirm
        kb={kb}
        source={confirming}
        liveAgents={liveAgents}
        busy={detach.isPending}
        error={detach.error}
        onClose={() => {
          setConfirming(null);
          detach.reset();
        }}
        onConfirm={(id) => detach.mutate(id, { onSuccess: () => setConfirming(null) })}
      />
    </Card>
  );
}
