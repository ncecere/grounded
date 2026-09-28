/*
 * Attaching a source to a knowledge base from anywhere on its page (C13):
 * the header's primary action, the Overview's empty state and the Sources
 * tab share one flow: the attach dialog, and the published agents a
 * classification rise would break.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, api, unwrap } from "@/api/client";
import { Button } from "@/components/ui/button/button";
import { toast } from "@/components/ui/toast/toast";
import { ClassificationImpactDialog } from "../../sources/impact";
import type { ClassificationImpact } from "../../sources/owner";
import { type KB, kbKey, kbsKey, useClassificationLevels, useSharedSources, useSources, useTeam } from "../common";
import { AttachSourceDialog } from "./attach-dialog";

/** The 409 classification_impact details of a failed attach, if that is why it failed. */
export const impactOf = (err: unknown) =>
  err instanceof ApiError && err.code === "classification_impact" && err.details ? (err.details as unknown as ClassificationImpact) : null;

/** Attach and detach a source; both put the returned KB into the cache. */
export function useKBSourceMutations(kb: KB, sourceName: (id: string) => string) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const onUpdated = (updated: KB) => {
    qc.setQueryData(kbKey(slug, kb.id), updated);
    qc.invalidateQueries({ queryKey: kbsKey(slug) });
  };
  const path = (sourceId: string) => ({ params: { path: { team: slug, kbId: kb.id, sourceId } } });
  const attach = useMutation({
    mutationFn: async (sourceId: string) => unwrap(await api.PUT("/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", path(sourceId))),
    onSuccess: (updated, sourceId) => {
      onUpdated(updated);
      toast.success(`${sourceName(sourceId)} attached`);
    },
  });
  const detach = useMutation({
    mutationFn: async (sourceId: string) => unwrap(await api.DELETE("/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", path(sourceId))),
    onSuccess: (updated, sourceId) => {
      toast.success(`${sourceName(sourceId)} detached`);
      onUpdated(updated);
    },
  });
  return { attach, detach };
}
export type KBSourceMutations = ReturnType<typeof useKBSourceMutations>;

/** The page's attach flow: request() opens the dialog; render `dialogs` once on the page. */
export function useAttachFlow(kb: KB) {
  const { slug } = useTeam();
  const levels = useClassificationLevels();
  const sources = useSources(slug);
  const shared = useSharedSources();
  const [attaching, setAttaching] = useState(false);
  const [impact, setImpact] = useState<ClassificationImpact | null>(null);
  const all = [...(sources.data ?? []), ...(shared.data ?? [])];
  const sourceName = (id: string) => all.find((src) => src.id === id)?.name ?? kb.sources.find((src) => src.id === id)?.name ?? "Source";
  const mutations = useKBSourceMutations(kb, sourceName);
  const { attach } = mutations;
  const levelName = (key: string) => levels.data?.find((l) => l.key === key)?.name ?? key;
  const dialogs = (
    <>
      {attaching && (
        <AttachSourceDialog
          kb={kb}
          attach={attach}
          onClose={() => setAttaching(false)}
          onImpact={(i) => {
            setAttaching(false);
            setImpact(i);
          }}
          impactOf={impactOf}
        />
      )}
      {impact && (
        <ClassificationImpactDialog
          impact={impact}
          levels={levels.data ?? []}
          teamLinks
          title={`Can't attach ${sourceName(attach.variables ?? "")} yet`}
          description={`The source is classified ${levelName(impact.classification)}, so attaching it would raise this knowledge base to that level. These published agents use the knowledge base but can't serve it: change what the table says for each, and publish them again, or remove this knowledge base from them.`}
          onClose={() => setImpact(null)}
        />
      )}
    </>
  );
  return { request: () => setAttaching(true), showImpact: setImpact, attachImpact: impactOf(attach.error), mutations, sourceName, all, dialogs };
}
export type AttachFlow = ReturnType<typeof useAttachFlow>;

/** "Attach source": the KB page's primary action, and the same words in its empty states. */
export function AttachSourceButton({ flow, variant = "primary" }: { flow: AttachFlow; variant?: "primary" | "secondary" }) {
  return (
    <Button variant={variant} onClick={flow.request}>
      <Plus aria-hidden /> Attach source
    </Button>
  );
}
