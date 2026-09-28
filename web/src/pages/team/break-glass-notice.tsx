/*
 * The owners' notice on every team page while a platform admin has an
 * active break-glass session on the team (ADR-0024): who, what they can
 * read, why and until when. Reads are listed in the team's audit log.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap } from "../../api/client";
import { breakGlassKey, isLive, personName, scopeWords, useNow } from "../../lib/break-glass";
import { formatDate } from "../../lib/format";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import t from "./team.module.css";

export function BreakGlassNotice({ team }: { team: string }) {
  const now = useNow(30_000);
  const sessions = useQuery({
    queryKey: [...breakGlassKey, "team", team],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/break-glass", { params: { path: { team } } })),
    refetchInterval: 60_000,
  });
  const live = (sessions.data ?? []).filter((s) => isLive(s, now));
  if (live.length === 0) return null;
  return (
    <div className={t.notices}>
      {live.map((s) => (
        <Alert
          key={s.id}
          tone="warning"
          title={`A platform admin can read this team's ${scopeWords(s.scopes)}`}
          actions={
            <Button size="sm" variant="secondary" render={<Link to="/teams/$team/settings" params={{ team }} search={{ tab: "audit" }} />}>
              See what was read
            </Button>
          }
        >
          <p>
            {personName(s.requestedBy)} ({s.requestedBy.email}) has break-glass access until {formatDate(s.expiresAt)}
            {s.decidedBy ? `, approved by ${personName(s.decidedBy)}` : ""}. Every read is recorded, and you'll get a summary when it ends.
          </p>
          <p>Reason given: {s.reason}</p>
        </Alert>
      ))}
    </div>
  );
}
