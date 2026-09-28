/*
 * A knowledge base's profile migration on its page (docs/phase5-deploy.md
 * §5 P2): while it runs, a notice with a meter (the KB keeps searching its
 * current profile); after the switch, until the old vectors go, a note
 * that a platform admin can still switch back. Platform admins get a link
 * to manage it, or to start one.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Meter } from "@/components/ui/meter/meter";
import { formatDate } from "@/lib/format";
import { documentsText, pollMs } from "../../admin/profile-migrations/common";

export function useKBMigration(team: string, kbId: string) {
  return useQuery({
    queryKey: ["teams", team, "kbs", kbId, "profile-migration"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs/{kbId}/profile-migration", { params: { path: { team, kbId } } })),
    refetchInterval: (q) => (q.state.data?.status === "running" ? pollMs : false),
  });
}

export function KBMigrationNotice({ team, kbId, isAdmin }: { team: string; kbId: string; isAdmin: boolean }) {
  const q = useKBMigration(team, kbId);
  const m = q.data;
  if (!m) return null;
  const manage = isAdmin && (
    <Button size="sm" variant="secondary" render={<Link to="/admin/profile-migrations" search={{ record: m.id } as never} />}>
      Manage migration
    </Button>
  );
  if (m.status === "switched") {
    return (
      <Alert tone="success" title={`Now on the embedding profile ${m.toProfile.name}`} actions={manage || undefined}>
        Moved from {m.fromProfile.name}
        {m.oldVectorsUntil ? `; a platform admin can switch back until ${formatDate(m.oldVectorsUntil)}` : ""}.
      </Alert>
    );
  }
  return (
    <Alert tone="info" title={`Moving to the embedding profile ${m.toProfile.name}`} actions={manage || undefined}>
      <p>Search and agents keep using {m.fromProfile.name} until every source is done, then switch at once.</p>
      <Meter
        label="Documents re-embedded"
        size="sm"
        value={m.progress.done}
        max={Math.max(m.progress.documents, 1)}
        valueText={documentsText(m.progress.done, m.progress.documents)}
        warningAt={2}
        criticalAt={2}
        showStatus={false}
        description={m.progress.failed ? `${m.progress.failed} documents need a platform admin's attention` : undefined}
      />
    </Alert>
  );
}
