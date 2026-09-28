/*
 * P-12: detaching a source from a knowledge base that a live agent uses
 * changes that agent's answers at once, so it asks first and names the
 * agents. Without a live agent the source is detached straight away.
 */
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { useAgents } from "../../agents/common";
import type { KB } from "../common";

/** Published, enabled agents of the team whose live version uses this knowledge base. */
export function useLiveAgentsUsing(team: string, kbId: string) {
  const agents = useAgents(team);
  return (agents.data ?? []).filter((a) => a.status === "active" && a.published?.knowledgeBases.some((k) => k.id === kbId));
}

type Props = {
  kb: KB;
  source: { id: string; name: string } | null;
  liveAgents: { id: string; name: string }[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (sourceId: string) => void;
};

export function DetachConfirm({ kb, source, liveAgents, busy, error, onClose, onConfirm }: Props) {
  const names = liveAgents.map((a) => a.name);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <AlertDialog
      open={source !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Detach ${source?.name ?? "this source"}?`}
      description={`${list} ${names.length === 1 ? "answers" : "answer"} from ${kb.name}. After you detach the source, ${names.length === 1 ? "it stops" : "they stop"} finding its documents right away, without a new publish.`}
      confirmLabel="Detach source"
      busy={busy}
      error={error}
      onConfirm={() => source && onConfirm(source.id)}
    />
  );
}
