/* Platform-shared sources (admin portal): the list with Used by (A6) and the detail page, reusing the team source components. */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Network, Plus, Share2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useIntent } from "../../lib/intents";
import { ListPage } from "@/components/templates/list-page";
import { useRecordParam } from "@/components/templates/record-page";
import { Button } from "@/components/ui/button/button";
import { useCreateSource } from "../sources/create";
import { SourceDetail } from "../sources/detail";
import { type DataSource, SourceOwnerContext, platformOwner, useSourceOwner } from "../sources/owner";
import { useClassificationLevels } from "../team/common";
import { useIsPlatformAdmin } from "./hooks";
import { groupUsage, sharedColumns, SharedUsagePage, useSharedSourceUsage } from "./shared-usage";

/** Provides the platform as the owner of the sources below. */
export function PlatformSources({ children }: { children: ReactNode }) {
  const isAdmin = useIsPlatformAdmin();
  const owner = useMemo(() => platformOwner(isAdmin), [isAdmin]);
  return <SourceOwnerContext.Provider value={owner}>{children}</SourceOwnerContext.Provider>;
}

export function SharedSourcesPage() {
  return (
    <PlatformSources>
      <SharedSourcesList />
    </PlatformSources>
  );
}

function SharedSourcesList() {
  const owner = useSourceOwner();
  const sources = useQuery({ queryKey: owner.keys.list, queryFn: () => owner.api.list() });
  const levels = useClassificationLevels();
  const usage = useSharedSourceUsage();
  const record = useRecordParam();
  const newSource = useCreateSource();
  useIntent("new-shared-source", () => owner.canEdit && newSource.start());
  const list = sources.data ?? [];
  const bySource = groupUsage(usage.data ?? []);
  const open = list.find((x) => x.id === record.id);
  const create = owner.canEdit && (
    <Button onClick={() => newSource.start()}>
      <Plus aria-hidden /> New shared source
    </Button>
  );

  return (
    <>
      <ListPage<DataSource>
        id="admin-shared-sources"
        title="Shared sources"
        description="Platform-managed uploads and websites any team approved for their classification can attach. Teams see the source and its counts, not its documents."
        primaryAction={create}
        caption="Shared sources"
        columns={sharedColumns(levels.data, bySource, owner)}
        data={list}
        getRowId={(x) => x.id}
        rowLabel={(x) => x.name}
        search={{ label: "Search shared sources" }}
        loading={sources.isLoading}
        error={sources.error}
        onRetry={() => void sources.refetch()}
        rowActions={(x) => [
          { label: "Open", render: owner.sourceLink(x.id) },
          { label: "Where it's used", icon: <Network aria-hidden />, onSelect: () => record.open(x.id) },
        ]}
        empty={{ icon: <Share2 />, title: "No shared sources yet.", description: "Create one for content many teams need, such as the academic calendar.", action: create || undefined }}
      />
      <SharedUsagePage
        source={open}
        open={Boolean(record.id)}
        loading={sources.isLoading || usage.isLoading}
        onClose={record.close}
        attachments={open ? (bySource.get(open.id) ?? []) : []}
      />
      {newSource.element}
    </>
  );
}

export function SharedSourceDetailPage() {
  const { sourceId } = useParams({ from: "/app/admin/shared-sources/$sourceId" });
  return (
    <PlatformSources>
      <SourceDetail sourceId={sourceId} />
    </PlatformSources>
  );
}
