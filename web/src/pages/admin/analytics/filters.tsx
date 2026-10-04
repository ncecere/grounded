/*
 * Admin → Analytics filters (A9): one team and one audience, in the URL
 * (?team=<slug>&audience=public) next to the date range, so a filtered view
 * can be linked to. Every count follows them; token use follows the team
 * only (the usage ledger has no audience).
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { Select, type SelectItem } from "@/components/ui/select/select";
import { audienceLabels } from "@/lib/terms";
import { useSearchParams } from "@/lib/url-search";
import an from "@/components/analytics/analytics.module.css";

type Audience = Schemas["Audience"];
export type AnalyticsFilter = { team?: string; audience?: Audience };

const ALL = "all";
const audiences = Object.keys(audienceLabels) as Audience[];

/** The filter in the URL, and a setter per field. */
export function useAnalyticsFilter() {
  const [params, setParams] = useSearchParams();
  const team = params.get("team") || undefined;
  const raw = params.get("audience");
  const audience = raw && (audiences as string[]).includes(raw) ? (raw as Audience) : undefined;
  const set = (key: "team" | "audience", value: string | undefined) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (value) out.set(key, value);
      else out.delete(key);
      return out;
    });
  return { filter: { team, audience } as AnalyticsFilter, set };
}

/** The filter row; `range` (the date range) comes first, as Costs puts it first above what it filters (VI-27). */
export function AnalyticsFilters({ filter, set, range }: ReturnType<typeof useAnalyticsFilter> & { range?: ReactNode }) {
  const teams = useQuery({
    queryKey: ["admin", "teams", "analytics-filter"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams", { params: { query: { limit: 200 } } })),
    staleTime: 60_000,
  });
  const teamItems: SelectItem[] = [
    { value: ALL, label: "All teams" },
    ...(teams.data?.items ?? []).map((t) => ({ value: t.team.slug, label: t.team.name })),
    // A linked team that isn't loaded (yet) still shows its slug.
    ...(filter.team && !teams.data?.items.some((t) => t.team.slug === filter.team) ? [{ value: filter.team, label: filter.team }] : []),
  ];
  const audienceItems: SelectItem[] = [{ value: ALL, label: "All audiences" }, ...audiences.map((a) => ({ value: a, label: audienceLabels[a] }))];
  return (
    <div className={an.filters} role="group" aria-label="Analytics filters">
      {range}
      <Select label="Team" size="sm" items={teamItems} value={filter.team ?? ALL} onValueChange={(v) => set("team", v && v !== ALL ? v : undefined)} className={an.filter} />
      <Select
        label="Audience"
        size="sm"
        items={audienceItems}
        value={filter.audience ?? ALL}
        onValueChange={(v) => set("audience", v && v !== ALL ? v : undefined)}
        className={an.filter}
      />
    </div>
  );
}
