/*
 * The Gaps page's Settings tab (docs/gaps.md, owner decision 4 of
 * 2026-10-01): "Confirm similar questions with SystemOne", off by default.
 * With it on, the hourly topics job asks SystemOne whether questions and
 * topics that are close but not clearly alike are about the same subject,
 * so more paraphrases end up in one topic. Saves at once (If-Match).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { Card } from "@/components/ui/card/card";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { Switch } from "@/components/ui/switch/switch";
import { useSystemOneStatus } from "@/lib/systemone";
import { gapSettingsKey, gapSettingsQuery } from "./queries";

export function GapSettingsTab({ team }: { team: string }) {
  const qc = useQueryClient();
  const q = useQuery(gapSettingsQuery(team));
  const systemOne = useSystemOneStatus();
  const available = Boolean(systemOne.data?.available);
  const save = useMutation({
    mutationFn: async (confirmSimilar: boolean) =>
      unwrap(await api.PUT("/v1/teams/{team}/gap-settings", { params: { path: { team }, header: ifMatch(q.data!.revision) }, body: { confirmSimilar } })),
    onSuccess: (st) => qc.setQueryData(gapSettingsKey(team), st),
    onError: () => void qc.invalidateQueries({ queryKey: gapSettingsKey(team) }),
  });
  const st = q.data;
  return (
    <Card title="Grouping questions" titleAs="h2" description="Questions join a topic when their meaning is close to a question already in it. Topics that grow alike merge.">
      {q.error ? (
        <ErrorAlert error={q.error} title="Couldn't load the settings" />
      ) : !st ? (
        <Skeleton height="4rem" />
      ) : (
        <>
          {save.error != null && <ErrorAlert error={save.error} title="Couldn't save" />}
          <Switch
            label="Confirm similar questions with SystemOne"
            description={
              available || st.confirmSimilar
                ? "Every hour, SystemOne checks whether questions that are close, but not clearly alike, are about the same subject, so more of them end up in one topic. Its use counts towards the team's spend."
                : "Needs a SystemOne model, which a platform admin sets up."
            }
            checked={st.confirmSimilar}
            disabled={save.isPending || (!available && !st.confirmSimilar)}
            onCheckedChange={(v) => save.mutate(v)}
          />
        </>
      )}
    </Card>
  );
}
