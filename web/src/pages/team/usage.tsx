/*
 * Team settings › Usage & limits (W10, DESIGN §11.1): what the team uses
 * against its limits, in the admin Limits page's four groups (Team resources
 * · Ingestion · Queries & chat · Public agents). Usage meters are sorted by
 * share used and warn at 80 % (critical at 100 %); limits without a usage
 * figure (rates per minute, per-person caps) sit in a disclosure. Public-agent
 * limits only show when the team has a public agent. Read-only: platform
 * admins set limits.
 */
import { useQuery } from "@tanstack/react-query";
import type { Schemas } from "../../api/client";
import { formatAmount, formatLimit, limitGroups, teamLimitsQuery } from "../../lib/limits";
import { useAuthConfig, useInstance } from "../../session";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Meter } from "@/components/ui/meter/meter";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useAgents } from "../agents/common";
import s from "../shared.module.css";
import u from "./usage.module.css";

type TeamLimit = Schemas["TeamLimit"];

const running = (it: TeamLimit) => it.key.startsWith("concurrent_");

/** When the figure applies: "Today (UTC)", "Running now", "This minute". */
function periodNote(it: TeamLimit) {
  if (it.period === "day") return "Today; resets at midnight UTC";
  if (it.period === "minute") return "This minute";
  return running(it) ? "Running now" : undefined;
}

/** Share of the limit used; blocked limits (0) count as full, unlimited as empty. */
export function usageShare(it: TeamLimit) {
  if (it.used === null || it.max === null) return 0;
  if (it.max === 0) return 1;
  return it.used / it.max;
}

/** Limits with a usage figure, most used first. */
export function sortByUse(items: TeamLimit[]) {
  return items.filter((it) => it.used !== null).sort((a, b) => usageShare(b) - usageShare(a));
}

function UsageMeter({ it }: { it: TeamLimit }) {
  const label = (
    <span className={u.label}>
      {it.label}
      {it.overridden && (
        <Badge size="sm" variant="outline">
          Set for your team
        </Badge>
      )}
    </span>
  );
  if (it.max === 0) {
    return (
      <div className={u.blocked}>
        {label}
        <span className={u.blockedText}>Blocked for your team</span>
      </div>
    );
  }
  return <Meter label={label} value={it.used ?? 0} max={it.max} formatValue={(v) => formatAmount(it.unit, v)} description={periodNote(it)} size="sm" />;
}

/** Where "Request more" goes: the support address, else the team request form. */
function useRequestMoreHref() {
  const instance = useInstance();
  const config = useAuthConfig();
  return instance.supportUrl ?? config.data?.teamRequestUrl ?? undefined;
}

/** "Usage and limits": meters against the team's effective limits. */
export function UsageCard({ team }: { team: string }) {
  const limits = useQuery({ ...teamLimitsQuery(team), refetchInterval: 30_000 });
  const agents = useAgents(team);
  const requestMore = useRequestMoreHref();
  const hasPublic = (agents.data ?? []).some((a) => a.audience === "public" && a.published);
  const items = limits.data?.items ?? [];
  const groups = limitGroups.filter((g) => g.key !== "public" || hasPublic);
  const staticLimits = groups.map((g) => ({ ...g, items: items.filter((it) => it.group === g.key && it.used === null) })).filter((g) => g.items.length > 0);
  return (
    <Card
      title="Usage and limits"
      description={
        <>
          Your team's usage against its limits. Platform admins set the limits.{" "}
          {requestMore && (
            <TextLink href={requestMore} target="_blank" rel="noreferrer">
              Request more
            </TextLink>
          )}
        </>
      }
    >
      {limits.isLoading ? (
        <Loading label="Loading usage…" />
      ) : limits.error ? (
        <ErrorAlert error={limits.error} />
      ) : (
        <div className={u.body}>
          <div className={u.groups}>
            {groups.map((g) => {
              const meters = sortByUse(items.filter((it) => it.group === g.key));
              if (meters.length === 0) return null;
              return (
                <section key={g.key} aria-labelledby={`usage-${g.key}`} className={u.group}>
                  <h3 id={`usage-${g.key}`} className={u.groupTitle}>
                    {g.label}
                  </h3>
                  <ul className={u.list}>
                    {meters.map((it) => (
                      <li key={it.key}>
                        <UsageMeter it={it} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {staticLimits.length > 0 && (
            <Disclosure title="Rate limits and per-person caps" summary="Limits without a running total, such as queries per minute.">
              <div className={u.groups}>
                {staticLimits.map((g) => (
                  <section key={g.key} aria-label={`${g.label}: rate limits`} className={u.group}>
                    <h3 className={u.groupTitle}>{g.label}</h3>
                    <DescriptionList items={g.items.map((it) => ({ label: it.label, value: formatLimit(it.unit, it.period, it.max) }))} />
                  </section>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      )}
      <p className={`${s.note} ${u.footnote}`}>Shared sources from the platform don't count against your team's limits.</p>
    </Card>
  );
}
