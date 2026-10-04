/*
 * Admin → Models → Reranking (docs/v0.4.2.md OW-2, owner decision A; docs/operations/rerank.md): always in the
 * sidebar, like SystemOne. The status, a setup guide until a rerank model exists, the settings (moved here from the
 * Models page's dialog) and a test that compares a search's order without and with reranking. Auditors read it all.
 */
import { QueryView } from "@/components/query-view";
import { useSearchParams } from "@/lib/url-search";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { useConnections, useModels } from "../models/common";
import { useHealthChecks } from "../models/health";
import { RerankGuide } from "./guide";
import { RerankSettingsForm, useRerankSettings } from "./settings";
import { offReason, RerankStatusCard } from "./status";
import { RerankTestCard } from "./test";

export function RerankingPage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useRerankSettings();
  const models = useModels();
  const conns = useConnections();
  const health = useHealthChecks();
  const rerankModels = (models.data ?? []).filter((m) => m.kind === "rerank");
  const st = settings.data;
  const model = st?.modelId ? models.data?.find((m) => m.id === st.modelId) : undefined;
  const connection = model ? conns.data?.find((c) => c.id === model.connectionId) : undefined;
  const loading = models.isLoading || conns.isLoading;
  // Back from the guide's Add connection (?connection=<id>).
  const [params] = useSearchParams();
  const added = conns.data?.find((c) => c.id === params.get("connection"));
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Reranking"
        description="A rerank model reads the question together with each passage a search found and puts the ones that answer it first, in one call. Once a platform admin chooses one here, every search reranks: agents, Try it, the retrieval API and MCP search."
      />
      <QueryView query={loading ? models : settings} loadingLabel="Loading reranking settings…">
        {st && (
          <>
            <RerankStatusCard saved={st} model={model} connection={connection} check={model && health.get(model.id)} />
            {/* Until a model is chosen, so its third step (Choose it here) can show too (AD2-06). */}
            {!st.modelId && (
              <RerankGuide connections={conns.data?.length ?? 0} rerankModels={rerankModels.length} chosen={false} isAdmin={isAdmin} added={added} />
            )}
            <RerankSettingsForm saved={st} models={rerankModels} health={health.get} isAdmin={isAdmin} />
            <RerankTestCard on={!offReason(st, model, connection)} />
          </>
        )}
      </QueryView>
    </Stack>
  );
}
