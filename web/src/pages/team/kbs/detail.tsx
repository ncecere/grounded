/*
 * A knowledge base's page on the DetailPage template (D3, W4): the facts
 * line (classification, profile, sources, documents, passages per search,
 * used by), "Attach source" as the primary action (C13), a "…" menu with
 * Delete, and pill tabs Overview · Sources · Try it · Settings. Stat cards
 * live only in Overview, which asks for a source while there is none.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Bot, ClipboardCheck, Database, FileCheck2, Layers, LayoutDashboard, Search, Settings2, Shuffle, Trash2 } from "lucide-react";
import { DetailPage } from "@/components/templates/detail-page";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { kbTabs } from "@/lib/tabs";
import { passagesCount, terms } from "@/lib/terms";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import s from "../../shared.module.css";
import { ClassificationBadge, type KB, kbQuery, plural, profileName, useClassificationLevels, useEmbeddingProfiles, useSharedSources, useSources, useTeam } from "../common";
import { ArchivedNotice, PageSkeleton } from "../layout";
import { RetrievePlayground } from "../retrieve";
import { useIsPlatformAdmin } from "../../admin/hooks";
import { useDeleteKB } from "./delete";
import { KBMigrationNotice } from "./migration";
import { KBSettings } from "./settings";
import { type AttachFlow, AttachSourceButton, useAttachFlow } from "./attach-flow";
import { KBSources } from "./sources";
import { UsedByAgents, useAgentsByKB } from "./used-by";
import { useEvaluationsOn } from "../evaluations/queries";
import { EvaluationsTab } from "../evaluations/sets-tab";

export function KBDetailPage() {
  const { kbId } = useParams({ from: "/app/teams/$team/kbs/$kbId" });
  return <KBDetail kbId={kbId} />;
}

export function KBDetail({ kbId }: { kbId: string }) {
  const { slug } = useTeam();
  const kb = useQuery(kbQuery(slug, kbId));
  if (kb.isLoading) return <PageSkeleton />;
  if (isNotFound(kb.error) || (!kb.error && !kb.data)) return <NotFoundState what="kb" />;
  if (kb.error) return <ErrorAlert error={kb.error} title="Couldn't load this knowledge base" />;
  return kb.data ? <KBPage kb={kb.data} /> : null;
}

/** Ready documents and passages over the attached sources (team and shared), or undefined while loading. */
function useKBCounts(kb: KB) {
  const { slug } = useTeam();
  const sources = useSources(slug);
  const shared = useSharedSources();
  if (sources.isLoading || shared.isLoading) return undefined;
  const attached = new Set(kb.sources.map((src) => src.id));
  return [...(sources.data ?? []), ...(shared.data ?? [])]
    .filter((src) => attached.has(src.id))
    .reduce((acc, src) => ({ ready: acc.ready + src.documents.ready, chunks: acc.chunks + src.documents.chunks }), { ready: 0, chunks: 0 });
}

function KBPage({ kb: k }: { kb: KB }) {
  const { slug, canEdit } = useTeam();
  const levels = useClassificationLevels();
  const profiles = useEmbeddingProfiles();
  const counts = useKBCounts(k);
  const uses = useAgentsByKB(slug).of(k.id);
  const del = useDeleteKB(k);
  const isAdmin = useIsPlatformAdmin();
  const attach = useAttachFlow(k);
  const evaluationsOn = useEvaluationsOn();

  return (
    <>
      <DetailPage
        title={k.name}
        description={k.description || undefined}
        meta={
          k.effectiveClassification ? <ClassificationBadge levels={levels.data} value={k.effectiveClassification} /> : <Badge variant="outline">No sources attached</Badge>
        }
        facts={[
          { id: "profile", label: "Embedding profile", value: profileName(profiles.data, k.embeddingProfileId) },
          { id: "sources", label: "Sources", value: plural(k.sources.length, "source") },
          { id: "docs", label: "Documents", value: counts ? plural(counts.ready, "ready document") : undefined },
          { id: "topk", label: "Passages per search", value: `${k.topK} passages per search` },
          { id: "used", label: "Used by", value: uses.length ? `used by ${plural(uses.length, "agent")}` : "not used by an agent" },
        ]}
        primaryAction={canEdit ? <AttachSourceButton flow={attach} /> : undefined}
        menuActions={[
          {
            label: "Change embedding profile…",
            icon: <Shuffle aria-hidden />,
            hidden: !isAdmin,
            render: <Link to="/admin/profile-migrations" search={{ start: k.id } as never} />,
          },
          { label: "Delete knowledge base…", icon: <Trash2 aria-hidden />, danger: true, hidden: !canEdit, onSelect: del.request },
        ]}
        notices={
          <>
            <ArchivedNotice>Its knowledge bases are read-only.</ArchivedNotice>
            <KBMigrationNotice team={slug} kbId={k.id} isAdmin={isAdmin} />
          </>
        }
        tabIds={kbTabs}
        tabsLabel="Knowledge base sections"
        tabs={[
          { value: "overview", label: "Overview", icon: <LayoutDashboard aria-hidden />, content: <KBOverview kb={k} counts={counts} attach={canEdit ? attach : undefined} /> },
          {
            value: "sources",
            label: "Sources",
            icon: <Database aria-hidden />,
            count: k.sources.length,
            content: <KBSources kb={k} flow={attach} />,
          },
          {
            value: "try",
            label: "Try it",
            icon: <Search aria-hidden />,
            content: (
              <Card title="Try it" description="Runs the same hybrid (vector + keyword) search agents use, without a chat model.">
                {k.sources.length === 0 ? (
                  <EmptyState size="compact" icon={<Database />} title="Attach a data source to search this knowledge base." />
                ) : (
                  <RetrievePlayground kbId={k.id} defaultTopK={k.topK} sources={k.sources} />
                )}
              </Card>
            ),
          },
          {
            value: "evaluations",
            label: "Evaluations",
            icon: <ClipboardCheck aria-hidden />,
            hidden: !canEdit || !evaluationsOn,
            content: <EvaluationsTab target={{ kbId: k.id, name: k.name }} />,
          },
          { value: "settings", label: "Settings", icon: <Settings2 aria-hidden />, hidden: !canEdit, content: <KBSettings kb={k} onDelete={del.request} /> },
        ]}
      />
      {del.dialog}
      {attach.dialogs}
    </>
  );
}

function KBOverview({ kb, counts, attach }: { kb: KB; counts: { ready: number; chunks: number } | undefined; attach?: AttachFlow }) {
  const { slug } = useTeam();
  const uses = useAgentsByKB(slug).of(kb.id);
  const value = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString());
  const stats = (
    <section aria-label="Knowledge base summary" className={s.stats}>
      <StatCard label="Data sources" value={kb.sources.length.toLocaleString()} icon={<Database />} hint={kb.sources.map((src) => src.name).join(", ") || "None attached yet"} />
      <StatCard label="Documents ready" value={value(counts?.ready)} icon={<FileCheck2 />} />
      <StatCard label={terms.Passages} value={value(counts?.chunks)} icon={<Layers />} hint={counts ? `${passagesCount(kb.topK)} per search` : undefined} />
      <StatCard label="Used by" value={plural(uses.length, "agent")} icon={<Bot />} hint={uses.length ? <UsedByAgents uses={uses} team={slug} /> : "No agent answers from it yet"} />
    </section>
  );
  if (kb.sources.length > 0) return stats;
  // An empty knowledge base: what to do first (C13), the same action as the header's.
  return (
    <Stack gap={6}>
      <Card>
        <EmptyState
          icon={<Database />}
          title="No data sources attached yet."
          description="Attach the sources this knowledge base should search. Agents can't answer from it until then."
          action={attach ? <AttachSourceButton flow={attach} variant="secondary" /> : undefined}
        />
      </Card>
      {stats}
    </Stack>
  );
}
