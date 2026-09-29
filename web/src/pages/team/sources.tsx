/*
 * Team data sources: the list and the source detail page (shared components
 * live in ../sources). The Data sources page has two pill tabs (?tab=):
 * Sources, and Crawl domains, the team's requests to crawl hosts outside the
 * allowlist (moved from Team settings in v0.2.1, I4). "New data source" is
 * the header's primary on Sources; Crawl domains has its own "Request a
 * domain". The header's description follows the tab.
 */
import { useParams } from "@tanstack/react-router";
import { Database, Globe, Plus } from "lucide-react";
import { useIntent } from "../../lib/intents";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { dataSourceTabs } from "@/lib/tabs";
import { terms } from "@/lib/terms";
import s from "../shared.module.css";
import { useCreateSource } from "../sources/create";
import { SourceDetail } from "../sources/detail";
import { SourcesTable } from "../sources/list";
import { useSourceOwner } from "../sources/owner";
import { useClassificationLevels, useEmbeddingProfiles, useKBs, useSources, useTeam } from "./common";
import { crawlDomainsDescription, DomainRequestsPage } from "./domains";
import { ArchivedNotice } from "./layout";

export { documentSummary, SourceStatusBadge } from "../sources/list";
export { isLowering } from "../sources/impact";
export { SourceDetail } from "../sources/detail";

export function SourcesPage() {
  const { canEdit, role } = useTeam();
  const owner = useSourceOwner();
  const [tab, setTab] = useUrlTab(dataSourceTabs);
  const newSource = useCreateSource();
  useIntent("new-source", () => {
    if (!canEdit) return;
    if (tab !== "sources") setTab("sources");
    newSource.start();
  });
  const create = canEdit && tab === "sources" && (
    <Button onClick={() => newSource.start()}>
      <Plus aria-hidden /> New data source
    </Button>
  );

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Data sources"
        // Each tab's own description (the walkthrough found Sources' above Crawl domains).
        description={
          tab === "crawl-domains" && role
            ? crawlDomainsDescription
            : "Uploaded files or pages from a website, for your knowledge bases. Each source has one classification and one embedding profile."
        }
        actions={create}
      />
      {tab === "sources" || !role ? owner.readOnlyNote : <ArchivedNotice>Its domain requests are read-only.</ArchivedNotice>}
      <PageTabs
        label="Data source sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "sources", label: "Sources", icon: <Database aria-hidden />, content: <SourcesList onCreate={canEdit ? () => newSource.start() : undefined} /> },
          // Members only: platform staff reading under break-glass see the sources alone.
          { value: "crawl-domains", label: terms.crawlDomains, icon: <Globe aria-hidden />, hidden: !role, content: <DomainRequestsPage embedded /> },
        ]}
      />
      {newSource.element}
    </Stack>
  );
}

/** The Sources tab: the team's sources, with the knowledge bases using each. */
function SourcesList({ onCreate }: { onCreate?: () => void }) {
  const { slug, canEdit } = useTeam();
  const sources = useSources(slug);
  const kbs = useKBs(slug);
  const levels = useClassificationLevels();
  const profiles = useEmbeddingProfiles();
  const usedBy = new Map<string, { id: string; name: string }[]>();
  for (const kb of kbs.data ?? []) for (const src of kb.sources) usedBy.set(src.id, [...(usedBy.get(src.id) ?? []), { id: kb.id, name: kb.name }]);
  return (
    <SourcesTable
      sources={sources.data ?? []}
      levels={levels.data}
      profiles={profiles.data}
      usedBy={usedBy}
      loading={sources.isLoading}
      error={sources.error}
      onRetry={() => void sources.refetch()}
      empty={{
        icon: <Database />,
        title: "No data sources yet.",
        description: canEdit ? "Create one to upload files or index a website." : "Editors, admins and owners can create data sources.",
        action: onCreate && (
          <Button variant="secondary" onClick={onCreate}>
            <Plus aria-hidden /> New data source
          </Button>
        ),
      }}
    />
  );
}

export function SourceDetailPage() {
  const { sourceId } = useParams({ from: "/app/teams/$team/sources/$sourceId" });
  return <SourceDetail sourceId={sourceId} />;
}
