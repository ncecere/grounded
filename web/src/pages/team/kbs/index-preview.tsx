/*
 * A knowledge base's index preview, for the team's editors (#18): the new index a platform admin built beside the current one, and what it
 * does to each question of the knowledge base's evaluation sets. Read-only; the platform admin decides. Members and anyone else get a 404 from
 * the API, and then nothing is shown (the notice above says a preview is under way).
 */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";
import { Badge } from "@/components/ui/badge/badge";
import { Stack } from "@/components/ui/layout/layout";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { mrrText, percentText, pollMs } from "../../admin/profile-migrations/common";
import s from "../../shared.module.css";
import p from "../../admin/profile-migrations/profile-migrations.module.css";

type Item = NonNullable<Schemas["ProfileMigrationComparison"]["sets"][number]["items"]>[number];

export const indexPreviewKey = (team: string, kbId: string) => ["teams", team, "kbs", kbId, "index-preview"];

export function useIndexPreview(team: string, kbId: string, enabled: boolean) {
  return useQuery({
    queryKey: indexPreviewKey(team, kbId),
    enabled,
    retry: false,
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs/{kbId}/index-preview", { params: { path: { team, kbId } } })),
    refetchInterval: (q) => (q.state.data?.running ? pollMs : false),
  });
}

/** "#2", "not found", "not indexed" or "error": where a question's expected page came back. */
const rankText = (status: string, rank: number | null | undefined) =>
  status === "pass" && rank ? `#${rank}` : status === "missing" ? "not indexed" : status === "error" ? "error" : status === "" ? "–" : "not found";

const changeBadge = (c: Item["change"]) =>
  c === "better" ? (
    <Badge tone="success" size="sm">
      Better
    </Badge>
  ) : c === "worse" ? (
    <Badge tone="danger" size="sm">
      Worse
    </Badge>
  ) : c === "same" ? (
    "Same"
  ) : (
    <Badge size="sm">Checked once</Badge>
  );

const order: Record<Item["change"], number> = { worse: 0, better: 1, only_live: 2, only_candidate: 2, same: 3 };

export function IndexPreviewDetail({ team, kbId }: { team: string; kbId: string }) {
  const q = useIndexPreview(team, kbId, true);
  const c = q.data;
  if (q.error || !c || c.sets.length === 0) return null;
  const done = c.sets.filter((x) => x.items);
  if (done.length === 0) return null;
  return (
    <Stack gap={4} className={p.preview}>
      {done.map((set) => {
        const items = [...(set.items ?? [])].sort((a, b) => order[a.change] - order[b.change]);
        const changed = items.filter((i) => i.change !== "same");
        return (
          <Stack key={set.setId} gap={2}>
            <p className={s.settingDescription}>
              <strong>{set.name}</strong>: recall {percentText(set.live?.summary.recall)} now, {percentText(set.candidate?.summary.recall)} with the new index; MRR{" "}
              {mrrText(set.live?.summary.mrr)} and {mrrText(set.candidate?.summary.mrr)}. {set.better} better, {set.worse} worse, {set.same} the same.
            </p>
            {changed.length > 0 && (
              <Table caption={`Questions that changed in ${set.name}`} columns={["Question", "Current index", "New index", "Change"]} density="compact">
                {changed.map((i) => (
                  <Tr key={i.caseId ?? i.question}>
                    <Td>{i.question}</Td>
                    <Td>{rankText(i.liveStatus, i.liveRank)}</Td>
                    <Td>{rankText(i.candidateStatus, i.candidateRank)}</Td>
                    <Td>{changeBadge(i.change)}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
