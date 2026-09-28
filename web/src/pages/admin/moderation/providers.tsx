/* Admin → Moderation › Providers (Q8): moderation and SystemOne models, which audiences use them, their check timeout (a timed-out check is retried once) and whether their scores are calibrated. */
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { Schemas } from "@/api/client";
import { ListPage } from "@/components/templates/list-page";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { audienceTabs, modelProviderHint, modelProviderName } from "@/lib/moderation";
import s from "../../shared.module.css";
import { EnabledBadge } from "../models/common";

type Model = Schemas["Model"];
type Policy = Schemas["ModerationPolicy"];

/** Whether a provider's scores are probabilities, so thresholds can be tuned (ADR-0019). */
export function calibrationText(m: Model): string {
  if (m.kind === "systemone" || m.moderationProvider === "moderations_endpoint") return "Calibrated";
  if (m.moderationProvider === "guardrail_chat") return "Calibrated with log-probabilities";
  return "Not calibrated";
}

type Props = { models: UseQueryResult<Model[]>; providers: Model[]; byAudience: Map<Schemas["Audience"], Policy | undefined> };

export function ProvidersTab({ models, providers, byAudience }: Props) {
  const timeout = (m: Model) => m.moderationTimeoutSeconds || undefined;
  const columns: DataTableColumn<Model>[] = [
    {
      id: "model",
      header: "Model",
      accessor: "displayName",
      sortable: true,
      rowHeader: true,
      cell: (m) => <CellText primary={m.displayName} secondary={<span className={s.mono}>{m.upstreamModel}</span>} />,
    },
    { id: "provider", header: "Provider", accessor: (m) => modelProviderName(m), sortable: true, cell: (m) => <CellText primary={modelProviderName(m)} secondary={modelProviderHint(m)} /> },
    {
      id: "usedBy",
      header: "Used by",
      accessor: (m) => audienceTabs.filter((t) => byAudience.get(t.value)?.modelId === m.id).length,
      cell: (m) => {
        const used = audienceTabs.filter((t) => byAudience.get(t.value)?.modelId === m.id);
        return used.length ? (
          <span className={s.badges}>
            {used.map((t) => (
              <Badge key={t.value} tone="info">
                {t.label}
              </Badge>
            ))}
          </span>
        ) : (
          <span className={s.muted}>No policy</span>
        );
      },
    },
    { id: "calibration", header: "Scores", accessor: calibrationText, muted: true },
    { id: "timeout", header: "Timeout per attempt", accessor: (m) => timeout(m) ?? 0, muted: true, cell: (m) => (timeout(m) ? `${timeout(m)} s` : "Platform default") },
    { id: "status", header: "Status", accessor: (m) => (m.enabled ? "Enabled" : "Disabled"), cell: (m) => <EnabledBadge enabled={m.enabled} /> },
  ];
  return (
    <ListPage<Model>
      id="admin-moderation-providers"
      caption="Moderation providers"
      columns={columns}
      data={providers}
      getRowId={(m) => m.id}
      rowLabel={(m) => m.displayName}
      rowActions={(m) => [{ label: "Open in Models", render: <Link to="/admin/models" search={{ record: m.id } as never} /> }]}
      loading={models.isLoading}
      error={models.error}
      onRetry={() => void models.refetch()}
      empty={{
        icon: <ShieldCheck />,
        title: "No moderation models yet.",
        description: "Add a model of kind Moderation or SystemOne on the Models page.",
        action: (
          <Button variant="secondary" render={<Link to="/admin/models" />}>
            Go to Models
          </Button>
        ),
      }}
    />
  );
}
