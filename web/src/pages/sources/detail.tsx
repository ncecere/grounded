/*
 * The source detail page (team and shared sources; upload and web) on the
 * DetailPage template (D3, W3): one contextual primary action (Sync now,
 * Upload files, or Resume when paused), a "…" menu (Pause, Delete last), the
 * facts line, and pill tabs Overview · Documents/Pages · Crawls (web) ·
 * Settings. Documents open in a sheet (?record=).
 */
import { useQuery } from "@tanstack/react-query";
import { FileText, History, LayoutDashboard, Network, Settings2, Upload } from "lucide-react";
import { useId, useState } from "react";
import { DetailPage } from "@/components/templates/detail-page";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { sourceTabs } from "@/lib/tabs";
import { SharedUsageTab } from "../admin/shared-usage";
import { ClassificationBadge, useClassificationLevels } from "../team/common";
import { DocumentsTable } from "../team/documents/table";
import { UploadSheet } from "../team/documents/upload";
import { PageSkeleton } from "../team/layout";
import { type SourceActions, useSourceActions } from "./actions";
import { BoilerplateCard } from "./boilerplate";
import { CrawlHistory, SyncButton, isActiveCrawl, syncBlockedReason, useCrawlFinished } from "./crawls";
import { SourceStatusBadge } from "./list";
import { SourceOverview, useSourceFacts } from "./overview";
import { type DataSource, ownerSourceQuery, useSourceOwner } from "./owner";
import { SourceSettings } from "./settings";
import { maintenanceReason, useMaintenance } from "@/lib/maintenance";
import w from "./detail.module.css";

export function SourceDetail({ sourceId }: { sourceId: string }) {
  const owner = useSourceOwner();
  const source = useQuery({
    ...ownerSourceQuery(owner, sourceId),
    // Poll while a crawl runs (live progress), documents are being
    // processed, or repeated blocks are being re-checked.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (isActiveCrawl(d.activeCrawl)) return 2000;
      if (d.documents.pending + d.documents.processing > 0) return 2000;
      return d.boilerplate?.pending ? 3000 : false;
    },
  });
  useCrawlFinished(source.data);

  if (source.isLoading) return <PageSkeleton />;
  if (isNotFound(source.error) || (!source.error && !source.data)) return <NotFoundState what="source" />;
  if (source.error) return <ErrorAlert error={source.error} title="Couldn't load this data source" />;
  if (!source.data) return null;
  return <SourcePage source={source.data} />;
}

function SourcePage({ source: src }: { source: DataSource }) {
  const owner = useSourceOwner();
  const levels = useClassificationLevels();
  const facts = useSourceFacts(src);
  const actions = useSourceActions(src);
  const [uploading, setUploading] = useState(false);
  const syncReasonId = useId();
  const web = src.type === "web";
  const maintenance = useMaintenance(owner.canEdit);
  // Why the primary action (Sync now / Upload files) is disabled, if it is.
  const reason = !owner.canEdit ? undefined : web ? syncBlockedReason(src, maintenance) : maintenance ? maintenanceReason(maintenance, "Uploading") : undefined;
  const canUpload = owner.canEdit && !actions.paused && !maintenance;

  return (
    <>
      <DetailPage
        title={src.name}
        description={src.description || undefined}
        meta={
          <>
            <ClassificationBadge levels={levels.data} value={src.classification} />
            <SourceStatusBadge status={src.status} />
          </>
        }
        facts={facts}
        primaryAction={<PrimaryAction source={src} actions={actions} onUpload={() => setUploading(true)} syncReasonId={syncReasonId} blocked={Boolean(reason)} />}
        menuActions={actions.menuActions}
        notices={
          <>
            {reason && !actions.paused && (
              <p id={syncReasonId} className={w.syncReason}>
                {reason}
              </p>
            )}
            {actions.paused && (
              <Alert tone="warning" title="This source is paused">
                {web
                  ? "It doesn't crawl on its schedule and can't be synced. Pages already indexed stay searchable."
                  : "It accepts no uploads, and documents waiting to be processed wait. Documents already indexed stay searchable."}
                {owner.canEdit ? " Resume it to continue." : ""}
              </Alert>
            )}
            {owner.readOnlyNote}
          </>
        }
        tabIds={sourceTabs}
        tabsLabel="Data source sections"
        tabs={[
          {
            value: "overview",
            label: "Overview",
            icon: <LayoutDashboard aria-hidden />,
            content: (
              <SourceOverview source={src} onUpload={canUpload ? () => setUploading(true) : undefined} extra={<BoilerplateCard source={src} />} />
            ),
          },
          {
            value: "documents",
            label: web ? "Pages" : "Documents",
            icon: <FileText aria-hidden />,
            count: src.documents.total,
            content: <DocumentsTable source={src} onUpload={canUpload && !web ? () => setUploading(true) : undefined} />,
          },
          {
            value: "crawls",
            label: "Crawls",
            icon: <History aria-hidden />,
            hidden: !web,
            content: (
              <Card title="Crawl history" description="The 20 most recent crawls, newest first." flush>
                <CrawlHistory source={src} />
              </Card>
            ),
          },
          {
            value: "used-by",
            label: "Used by",
            icon: <Network aria-hidden />,
            hidden: owner.kind !== "platform",
            content: <SharedUsageTab sourceId={src.id} />,
          },
          {
            value: "settings",
            label: "Settings",
            icon: <Settings2 aria-hidden />,
            hidden: !owner.canEdit,
            content: <SourceSettings source={src} levels={levels.data ?? []} actions={actions} />,
          },
        ]}
      />
      {actions.dialog}
      {!web && owner.canEdit && <UploadSheet source={src} open={uploading} onClose={() => setUploading(false)} />}
    </>
  );
}

/** Resume (paused), Sync now (web) or Upload files (uploads); nothing for viewers. */
function PrimaryAction({
  source,
  actions,
  onUpload,
  syncReasonId,
  blocked,
}: {
  source: DataSource;
  actions: SourceActions;
  onUpload: () => void;
  syncReasonId: string;
  /** Uploads are paused (maintenance); the reason is in the element with id syncReasonId. */
  blocked: boolean;
}) {
  const owner = useSourceOwner();
  if (!owner.canEdit) return null;
  if (actions.paused)
    return (
      <Button loading={actions.status.isPending} onClick={actions.toggle}>
        {actions.resumeIcon} Resume
      </Button>
    );
  if (source.type === "web") return <SyncButton source={source} reasonId={syncReasonId} />;
  return (
    <Button onClick={onUpload} disabled={blocked} aria-describedby={blocked ? syncReasonId : undefined}>
      <Upload aria-hidden /> Upload files
    </Button>
  );
}
