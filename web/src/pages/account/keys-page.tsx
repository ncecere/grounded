/*
 * Your API keys (/settings/api-keys), from the account menu (E18): the person's personal keys in every team they
 * belong to, in one place. Keys belong to a team, so the list is each team's own (the API already returns a member
 * only their own, and a team admin every key, so this page keeps the personal keys that are the person's). Each
 * key links to its page in the team's settings, where it is revoked; a key is created there too.
 */
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Time } from "@/components/ui/time/time";
import { requestIntent } from "@/lib/intents";
import { useCurrentUser } from "@/session";
import s from "../shared.module.css";
import { keysKey } from "../team/common";
import { ExpiryBadge } from "../team/keys/key-record";
import type { APIKey } from "../team/keys/scopes";
import a from "./account.module.css";

export function MyKeysPage() {
  const me = useCurrentUser();
  const results = useQueries({
    queries: me.teams.map((t) => ({
      queryKey: keysKey(t.slug),
      queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/api-keys", { params: { path: { team: t.slug } } })),
    })),
  });
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="API keys"
        description="Your personal keys in each of your teams. A personal key acts as you, and stops working when you leave its team."
      />
      {me.teams.length === 0 && <p className={s.muted}>API keys belong to a team. Once you are in a team, your keys are listed here.</p>}
      {me.teams.map((t, i) => {
        const q = results[i]!;
        const mine: APIKey[] = (q.data ?? []).filter((k) => k.kind === "personal" && k.userId === me.user.id);
        const archived = t.status === "archived";
        return (
          <Card
            key={t.id}
            title={t.name}
            actions={archived ? <Badge size="sm">Archived</Badge> : undefined}
            footer={
              archived ? undefined : (
                <TextLink
                  render={<Link to="/teams/$team/settings" params={{ team: t.slug }} search={{ tab: "api-keys" }} onClick={() => requestIntent("new-api-key")} />}
                  aria-label={`Create a key in ${t.name}`}
                >
                  Create a key
                </TextLink>
              )
            }
          >
            {q.isError ? (
              <ErrorAlert error={q.error} title="Could not load the keys in this team" onRetry={() => void q.refetch()} retrying={q.isFetching} />
            ) : q.isPending ? (
              <p className={s.muted}>Loading…</p>
            ) : mine.length === 0 ? (
              <p className={s.muted}>No personal keys in this team.</p>
            ) : (
              <ul className={a.rows}>
                {mine.map((k) => (
                  <li key={k.id} className={a.row}>
                    <span className={a.rowMain}>
                      <TextLink render={<Link to="/teams/$team/settings" params={{ team: t.slug }} search={{ tab: "api-keys", record: k.id }} />}>{k.name}</TextLink>
                      <code className={s.mono}>{k.prefix}</code>
                    </span>
                    <span className={a.rowMeta}>
                      <span>
                        Expires <ExpiryBadge k={k} />
                      </span>
                      <span>{k.lastUsedAt ? <>Last used <Time value={k.lastUsedAt} /></> : "Never used"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </Stack>
  );
}
