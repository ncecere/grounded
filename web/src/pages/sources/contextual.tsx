import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { useCurrentUser } from "../../session";
import { isNotFound } from "@/components/not-found";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Spinner } from "@/components/ui/spinner/spinner";
import { ContextualDialog } from "./contextual-dialog";
import { useSourceOwner } from "./owner";
import c from "./contextual.module.css";

/** Counts/state only for team members; configuration/price estimates require
 * actual platform capabilities, not merely a team editor/owner role. */
export function ContextualCard({ sourceId }: { sourceId: string }) {
  const owner = useSourceOwner();
  const { capabilities } = useCurrentUser();
  const adminRead = capabilities.platformAdmin || capabilities.platformAuditor;
  const queryKey = ["source-contextual", adminRead ? "platform" : owner.team, sourceId] as const;
  const [editing, setEditing] = useState(false);
  const state = useQuery({
    queryKey,
    enabled: adminRead || Boolean(owner.team),
    retry: false,
    queryFn: async () => adminRead
      ? unwrap(await api.GET("/v1/admin/sources/{sourceId}/contextual", { params: { path: { sourceId } } }))
      : unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}/contextual", { params: { path: { team: owner.team!, sourceId } } })),
  });
  const estimate = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/sources/{sourceId}/contextual/estimate", { params: { path: { sourceId } }, body: {} })),
  });
  if ((!adminRead && !owner.team) || isNotFound(state.error)) return null;
  return (
    <>
      <Card title="Contextual chunks" description="Optional model-generated embedding context. Original passages, keyword search, citations and viewers stay unchanged."
        actions={capabilities.platformAdmin && state.data ? <Button variant="secondary" onClick={() => setEditing(true)}>Configure contextual chunks</Button> : undefined}>
        <div className={c.body}>
          {state.isLoading ? <Spinner size="sm" label="Loading contextual state" /> : <ErrorAlert error={state.error} title="Couldn't load contextual state" />}
          {state.data && <>
            <p>{state.data.enabled ? `Opted in with ${state.data.modelName || "the configured chat model"}. Saving settings does not rewrite any index.` : "Off for this source. No contextual model work is authorized."}</p>
            {!state.data.platformEnabled && <Alert tone="info">Contextual chunks are switched off for this installation.</Alert>}
            <dl className={c.facts}>
              <div><dt>Model attempts</dt><dd>{state.data.calls.attempts}</dd></div>
              <div><dt>Unknown-usage attempts</dt><dd>{state.data.calls.unknown}</dd></div>
              <div><dt>Cached contexts</dt><dd>{state.data.cachedContexts}</dd></div>
            </dl>
            {adminRead ? <>
              <Button variant="secondary" loading={estimate.isPending} onClick={() => estimate.mutate()}>Estimate saved contextual settings</Button>
              <p className={c.hint}>This reads the stored passages and saved limits. It sends no model request and creates no candidate. To activate, build and compare an index preview, then explicitly switch.</p>
              <Link to="/admin/embedding-profiles">Open embedding profiles and index previews</Link>
              <ErrorAlert error={estimate.error} title="Couldn't estimate contextual work" />
              {estimate.data && <ContextualEstimate estimate={estimate.data} />}
            </> : <p className={c.hint}>Only platform admins can configure this opt-in and its spending limits. Ask one to estimate and preview it first.</p>}
          </>}
        </div>
      </Card>
      {editing && capabilities.platformAdmin && state.data && <ContextualDialog state={state.data} queryKey={queryKey} onClose={() => { setEditing(false); estimate.reset(); }} />}
    </>
  );
}

function ContextualEstimate({ estimate }: { estimate: Schemas["ContextualSourceEstimate"] }) {
  return (
    <div className={c.body} aria-label="Saved contextual estimate" aria-live="polite">
      <p>Up to {estimate.calls} context calls, {estimate.inputTokensMax} input tokens and {estimate.outputTokensMax} output tokens, before cache reuse.</p>
      <p>{estimate.cost.priceKnown ? `Configured-price estimate: ${estimate.cost.maxAmount} ${estimate.cost.currency}. Not a provider invoice guarantee.` : "Price unknown: configure both chat token prices before previewing. Unknown is not zero."}</p>
      {estimate.blockers.length > 0 ? <ul className={c.blockers} aria-label="Contextual preview blockers">{estimate.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
        : <p>No blockers in this estimate. Live admission still checks current prices, source limits and scope before each call.</p>}
    </div>
  );
}
