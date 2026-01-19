import { api } from "../lib/api";
import { SourcesManager } from "./SourcesManager";

interface SourcesProps {
  kbId: string;
  onBack: () => void;
}

export function Sources({ kbId, onBack }: SourcesProps) {
  return (
    <SourcesManager
      kbId={kbId}
      onBack={onBack}
      title="Sources"
      description="Manage sources for this knowledge base"
      listSources={api.listSources}
      listSourceRuns={api.listSourceRuns}
      getSourceStats={api.getSourceStats}
      createSource={api.createSource}
      updateSource={api.updateSource}
      deleteSource={api.deleteSource}
      triggerSourceRun={api.triggerSourceRun}
      cancelSourceRun={api.cancelSourceRun}
      uploadFile={api.uploadFile}
    />
  );
}
