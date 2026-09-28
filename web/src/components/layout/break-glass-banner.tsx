/*
 * The break-glass banner (ADR-0024): above every page for a platform admin
 * with an active session, with the team, what they can read, the time left
 * and End now. The countdown updates quietly (no live region); the session
 * list is polled, and a session past its end disappears.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap } from "../../api/client";
import { type BreakGlassSession, breakGlassKey, isLive, scopeWords, timeLeft, useMyBreakGlass, useNow } from "../../lib/break-glass";
import { type Me } from "../../session";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { toast } from "@/components/ui/toast/toast";
import styles from "./break-glass-banner.module.css";

export function BreakGlassBanner({ me }: { me: Me }) {
  const sessions = useMyBreakGlass(me.capabilities.platformAdmin);
  const now = useNow();
  const live = sessions.filter((s) => isLive(s, now));
  if (live.length === 0) return null;
  return (
    <>
      {live.map((s) => (
        <SessionBanner key={s.id} session={s} now={now} />
      ))}
    </>
  );
}

function SessionBanner({ session: s, now }: { session: BreakGlassSession; now: number }) {
  const qc = useQueryClient();
  const end = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/break-glass/{sessionId}/end", { params: { path: { sessionId: s.id } } })),
    onSuccess: () => toast.success("Break-glass session ended", `You can no longer read ${s.team.name}'s content.`),
    onSettled: () => qc.invalidateQueries({ queryKey: breakGlassKey }),
  });
  const docs = s.scopes.includes("documents");
  const convs = s.scopes.includes("conversations");
  return (
    <Alert
      tone="warning"
      title={`Break-glass: you can read ${s.team.name}'s ${scopeWords(s.scopes)}`}
      className={styles.banner}
      actions={
        <>
          {docs && (
            <Button size="sm" variant="secondary" render={<Link to="/teams/$team/sources" params={{ team: s.team.slug }} />}>
              Documents
            </Button>
          )}
          {convs && (
            <Button size="sm" variant="secondary" render={<Link to="/admin/break-glass/$sessionId/conversations" params={{ sessionId: s.id }} />}>
              Conversations
            </Button>
          )}
          <Button size="sm" variant="danger" loading={end.isPending} onClick={() => end.mutate()}>
            End now
          </Button>
        </>
      }
    >
      <p className={styles.reason}>
        <strong>{timeLeft(s.expiresAt!, now)}</strong> (until {new Date(s.expiresAt!).toLocaleTimeString(undefined, { timeStyle: "short" })}).
      </p>
      <p className={styles.detail}>Read-only. Every read is recorded in the audit log, and the team's owners were notified and get a summary when it ends.</p>
      {end.error ? <ErrorAlert error={end.error} title="Couldn't end the session" /> : null}
    </Alert>
  );
}
