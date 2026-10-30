import { useMutation } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import s from "../../shared.module.css";

/** Explicit read-only estimate before authorizing a contextual candidate build.
 * A changed KB cannot reuse the previous KB's estimate; the server rechecks
 * current prices/admission when the build is submitted and before each call. */
export function useContextualPreviewEstimate(kbId: string, needed: boolean) {
  const estimate = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST("/v1/admin/profile-migrations/contextual-estimate", { body: { kbId: id } })),
  });
  const current = estimate.variables === kbId ? estimate.data : undefined;
  const ready = !needed || Boolean(current && current.blockers.length === 0);
  const element = needed ? <>
    <p className={s.settingDescription}>Only opted-in sources are sent to their configured chat model. Configure explicit source limits and both token prices first. Preview contextual work separately from passage/chunker changes.</p>
    <Button type="button" variant="secondary" disabled={!kbId} loading={estimate.isPending} onClick={() => estimate.mutate(kbId)}>Estimate contextual work before building</Button>
    <p className={s.settingDescription}>Estimating creates no candidate and sends no model request. Building spends admitted work; live indexes stay unchanged until an explicit switch.</p>
    <ErrorAlert error={estimate.error} title="Couldn't estimate contextual work" />
    {current && <Alert tone={current.blockers.length ? "warning" : "info"} title="Saved-source contextual estimate">
      <p>Up to {current.calls} context calls, {current.inputTokensMax} input tokens and {current.outputTokensMax} output tokens, before cache reuse.</p>
      <p>{current.cost.priceKnown ? `Configured-price estimate: ${current.cost.maxAmount} ${current.cost.currency}. Not a provider invoice guarantee.` : "Price unknown. Both chat token prices are required; unknown is not zero."}</p>
      {current.blockers.length > 0 && <ul aria-label="Contextual build blockers">{current.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>}
      <p>Prices, limits and scope are checked again on submission and during live admission.</p>
    </Alert>}
  </> : null;
  return { ready, element };
}
