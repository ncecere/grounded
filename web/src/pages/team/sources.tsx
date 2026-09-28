/* Team data sources: the list and the source detail page (shared components live in ../sources). */
import { useParams } from "@tanstack/react-router";
import { Database, Plus } from "lucide-react";
import { useIntent } from "../../lib/intents";
import { Button } from "@/components/ui/button/button";
import { useCreateSource } from "../sources/create";
import { SourceDetail } from "../sources/detail";
import { SourcesTable } from "../sources/list";
import { useSourceOwner } from "../sources/owner";
import { useClassificationLevels, useEmbeddingProfiles, useKBs, useSources, useTeam } from "./common";

export { documentSummary, SourceStatusBadge } from "../sources/list";
export { isLowering } from "../sources/impact";
export { SourceDetail } from "../sources/detail";

export function SourcesPage() {
  const { slug, canEdit } = useTeam();
  const owner = useSourceOwner();
  const sources = useSources(slug);
  const kbs = useKBs(slug);
  const levels = useClassificationLevels();
  const profiles = useEmbeddingProfiles();
  const newSource = useCreateSource();
  useIntent("new-source", () => canEdit && newSource.start());
  const usedBy = new Map<string, { id: string; name: string }[]>();
  for (const kb of kbs.data ?? []) for (const src of kb.sources) usedBy.set(src.id, [...(usedBy.get(src.id) ?? []), { id: kb.id, name: kb.name }]);
  const create = canEdit && (
    <Button onClick={() => newSource.start()}>
      <Plus aria-hidden /> New data source
    </Button>
  );

  return (
    <>
      <SourcesTable
        title="Data sources"
        description="Uploaded files or pages from a website, for your knowledge bases. Each source has one classification and one embedding profile."
        primaryAction={create}
        notices={owner.readOnlyNote}
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
          action: canEdit && (
            <Button variant="secondary" onClick={() => newSource.start()}>
              <Plus aria-hidden /> New data source
            </Button>
          ),
        }}
      />
      {newSource.element}
    </>
  );
}

export function SourceDetailPage() {
  const { sourceId } = useParams({ from: "/app/teams/$team/sources/$sourceId" });
  return <SourceDetail sourceId={sourceId} />;
}
