/*
 * A knowledge base's Sources tab (W4): the attached sources (documents, last
 * sync, a "…" menu with Detach) and an explicit "Attach source" button that
 * opens a dialog listing every source, the ones that can't be attached
 * disabled with their reason (embedding profile, classification).
 */
import { Stack } from "@/components/ui/layout/layout";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Database, Plus, Unlink } from "lucide-react";
import { useState } from "react";
import { ApiError, api, unwrap } from "@/api/client";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { toast } from "@/components/ui/toast/toast";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { ClassificationImpactDialog, impactSummary } from "../../sources/impact";
import type { ClassificationImpact } from "../../sources/owner";
import { ClassificationBadge, type KB, kbKey, kbsKey, plural, useClassificationLevels, useSharedSources, useSources, useTeam } from "../common";
import { AttachSourceDialog } from "./attach-dialog";
import { DetachConfirm, useLiveAgentsUsing } from "./detach-confirm";

type Attached = KB["sources"][number];

/** The 409 classification_impact details of a failed attach, if that is why it failed. */
const impactOf = (err: unknown) =>
  err instanceof ApiError && err.code === "classification_impact" && err.details ? (err.details as unknown as ClassificationImpact) : null;

/** Attach and detach a source; both put the returned KB into the cache. */
export function useKBSourceMutations(kb: KB, sourceName: (id: string) => string) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const onUpdated = (updated: KB) => {
    qc.setQueryData(kbKey(slug, kb.id), updated);
    qc.invalidateQueries({ queryKey: kbsKey(slug) });
  };
  const path = (sourceId: string) => ({ params: { path: { team: slug, kbId: kb.id, sourceId } } });
  const attach = useMutation({
    mutationFn: async (sourceId: string) => unwrap(await api.PUT("/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", path(sourceId))),
    onSuccess: (updated, sourceId) => {
      onUpdated(updated);
      toast.success(`${sourceName(sourceId)} attached`);
    },
  });
  const detach = useMutation({
    mutationFn: async (sourceId: string) => unwrap(await api.DELETE("/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", path(sourceId))),
    onSuccess: (updated, sourceId) => {
      toast.success(`${sourceName(sourceId)} detached`);
      onUpdated(updated);
    },
  });
  return { attach, detach };
}
export type KBSourceMutations = ReturnType<typeof useKBSourceMutations>;

export function KBSources({ kb }: { kb: KB }) {
  const { slug, canEdit } = useTeam();
  const levels = useClassificationLevels();
  const sources = useSources(slug);
  const shared = useSharedSources();
  const [attaching, setAttaching] = useState(false);
  const [impact, setImpact] = useState<ClassificationImpact | null>(null);
  const all = [...(sources.data ?? []), ...(shared.data ?? [])];
  const sourceName = (id: string) => all.find((src) => src.id === id)?.name ?? kb.sources.find((src) => src.id === id)?.name ?? "Source";
  const mutations = useKBSourceMutations(kb, sourceName);
  const { attach, detach } = mutations;
  const liveAgents = useLiveAgentsUsing(slug, kb.id);
  const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);
  const requestDetach = (src: { id: string; name: string }) => (liveAgents.length > 0 ? setConfirming(src) : detach.mutate(src.id));
  const attachImpact = impactOf(attach.error);
  const levelName = (key: string) => levels.data?.find((l) => l.key === key)?.name ?? key;

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
    <Card
      title="Data sources"
      description="The sources this knowledge base searches. They must all use its embedding profile."
      actions={
        canEdit && (
          <Button variant="secondary" onClick={() => setAttaching(true)}>
            <Plus aria-hidden /> Attach source
          </Button>
        )
      }
    >
      <Stack gap={4}>
        {detach.error && !confirming ? <ErrorAlert error={detach.error} /> : null}
        {attachImpact && (
          <div>
            <Alert
              tone="warning"
              title={`${sourceName(attach.variables ?? "")} wasn't attached`}
              actions={
                <Button size="sm" variant="secondary" onClick={() => setImpact(attachImpact)}>
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
            description: canEdit ? "Attach the sources this knowledge base should search." : undefined,
            action: canEdit ? (
              <Button variant="secondary" onClick={() => setAttaching(true)}>
                <Plus aria-hidden /> Attach source
              </Button>
            ) : undefined,
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
      {attaching && (
        <AttachSourceDialog
          kb={kb}
          attach={attach}
          onClose={() => setAttaching(false)}
          onImpact={(i) => {
            setAttaching(false);
            setImpact(i);
          }}
          impactOf={impactOf}
        />
      )}
      {impact && (
        <ClassificationImpactDialog
          impact={impact}
          levels={levels.data ?? []}
          teamLinks
          title={`Can't attach ${sourceName(attach.variables ?? "")} yet`}
          description={`The source is classified ${levelName(impact.classification)}, so attaching it would raise this knowledge base to that level. These published agents use the knowledge base but can't serve it: change what the table says for each, and publish them again, or remove this knowledge base from them.`}
          onClose={() => setImpact(null)}
        />
      )}
    </Card>
  );
}
