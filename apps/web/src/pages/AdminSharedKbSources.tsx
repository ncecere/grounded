import { adminApi } from "../lib/api";
import { SourcesManager } from "./SourcesManager";
import { GlobeLock } from "lucide-react";

interface AdminSharedKbSourcesProps {
  kbId: string;
  onBack: () => void;
}

export function AdminSharedKbSources({ kbId, onBack }: AdminSharedKbSourcesProps) {
  return (
    <SourcesManager
      kbId={kbId}
      onBack={onBack}
      title={
        <div className="flex items-center gap-2">
          <span>Shared KB Sources</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">
            <GlobeLock className="w-3 h-3" />
            Shared
          </span>
        </div>
      }
      description="Manage sources for this shared knowledge base"
      actions={null}
      listSources={adminApi.listSharedKbSources}
      listSourceRuns={adminApi.listSharedKbSourceRuns}
      getSourceStats={adminApi.getSharedKbSourceStats}
      createSource={adminApi.createSharedKbSource}
      updateSource={adminApi.updateSharedKbSource}
      deleteSource={(kbIdValue, sourceId) => adminApi.deleteSharedKbSource(kbIdValue, sourceId).then(() => undefined)}
      triggerSourceRun={adminApi.triggerSharedKbSourceRun}
      cancelSourceRun={(kbIdValue, runId, sourceId) =>
        adminApi.cancelSharedKbSourceRun(kbIdValue, sourceId || "", runId)
      }
      uploadFile={adminApi.uploadSharedKbFile}
    />
  );
}
