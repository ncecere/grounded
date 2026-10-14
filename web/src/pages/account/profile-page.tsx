/*
 * Profile (/settings/profile), from the account menu (E18): who the person is as Grounded knows them, their
 * teams, and where the rest of their account is (notifications, connected apps, API keys). It is reachable for
 * everyone, including people in no team. Nothing here is edited: the name and email come from the sign-in.
 */
import { Link } from "@tanstack/react-router";
import { roleLabels } from "@/components/roles";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Time } from "@/components/ui/time/time";
import { useCurrentUser } from "@/session";
import s from "../shared.module.css";
import { platformRoleLabels } from "../admin/people/common";
import a from "./account.module.css";

export function ProfilePage() {
  const me = useCurrentUser();
  const { user, teams } = me;
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title="Profile" description="Your account in this Grounded. Your name and email come from how you sign in." />
      <Card title="You">
        <dl className={a.facts}>
          <dt>Name</dt>
          <dd>{user.displayName}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          {user.platformRole !== "none" && (
            <>
              <dt>Platform role</dt>
              <dd>{platformRoleLabels[user.platformRole]}</dd>
            </>
          )}
          <dt>Member since</dt>
          <dd>
            <Time value={user.createdAt} format="date" />
          </dd>
          {user.lastLoginAt && (
            <>
              <dt>Last sign-in</dt>
              <dd>
                <Time value={user.lastLoginAt} />
              </dd>
            </>
          )}
        </dl>
      </Card>
      <Card title="Your teams">
        {teams.length === 0 ? (
          <p className={s.muted}>You are not in a team yet.</p>
        ) : (
          <ul className={a.rows}>
            {teams.map((t) => (
              <li key={t.id} className={a.row}>
                <span className={a.rowMain}>
                  <TextLink render={<Link to="/teams/$team" params={{ team: t.slug }} />}>{t.name}</TextLink>
                  {t.status === "archived" && <Badge size="sm">Archived</Badge>}
                </span>
                <span className={a.rowMeta}>{roleLabels[t.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Your account">
        <ul className={a.rows}>
          {teams.length > 0 && (
            <li>
              <TextLink render={<Link to="/settings/api-keys" />}>API keys</TextLink>
              <span className={s.muted}> · your personal keys, in every team</span>
            </li>
          )}
          <li>
            <TextLink render={<Link to="/settings/notifications" />}>Notification settings</TextLink>
            <span className={s.muted}> · which events email you</span>
          </li>
          <li>
            <TextLink render={<Link to="/settings/connected-apps" />}>Connected apps</TextLink>
            <span className={s.muted}> · AI tools connected as you</span>
          </li>
        </ul>
      </Card>
    </Stack>
  );
}
