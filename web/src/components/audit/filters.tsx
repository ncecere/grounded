/*
 * The audit log's filter bar: action group, person and a date range. Dates
 * are local calendar days; the range sent to the API is [from 00:00, the day
 * after "to" 00:00).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "../../api/client";
import { useDebounced } from "../../pages/admin/hooks";
import { Button } from "@/components/ui/button/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { actionGroups } from "./labels";
import type { AuditFilters } from "./audit-log";
import type { AuditScope } from "./target";
import a from "./audit.module.css";

/** What the filter bar edits: an action group prefix, a user ID and YYYY-MM-DD dates ("" = any). */
export type AuditFilterState = { action: string; person: string; from: string; to: string };
export const noAuditFilters: AuditFilterState = { action: "", person: "", from: "", to: "" };

const localMidnight = (day: string, addDays = 0) => {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
};

/** The API filters for a filter-bar state; the "to" day is inclusive. */
export function toAuditFilters(f: AuditFilterState): AuditFilters {
  const out: AuditFilters = {};
  if (f.action) out.action = f.action;
  if (f.person) out.actorUserId = f.person;
  if (f.from) out.from = localMidnight(f.from);
  // A reversed range would be rejected; the date inputs prevent it, typed text may not.
  if (f.to && !(f.from && f.from > f.to)) out.to = localMidnight(f.to, 1);
  return out;
}

/** People to filter by: the team's members, or users matching the typed text (platform log). */
function usePeople(scope: AuditScope, search: string): ComboboxOption[] {
  const q = useDebounced(search.trim(), 250);
  const members = useQuery({
    queryKey: ["team", scope.kind === "team" ? scope.team : "", "members"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team: scope.kind === "team" ? scope.team : "" } } })),
    enabled: scope.kind === "team",
  });
  const users = useQuery({
    queryKey: ["admin", "users", "audit-filter", q],
    queryFn: async () => unwrap(await api.GET("/v1/admin/users", { params: { query: { q: q || undefined, limit: 20 } } })),
    enabled: scope.kind === "platform",
  });
  const list = scope.kind === "team" ? (members.data ?? []).map((m) => m.user) : (users.data?.items ?? []);
  return list.map((u) => ({ value: u.id, label: u.displayName || u.email, hint: u.displayName ? u.email : undefined }));
}

type BarProps = { scope: AuditScope; value: AuditFilterState; onChange: (next: AuditFilterState) => void };

export function AuditFilterBar({ scope, value, onChange }: BarProps) {
  const [search, setSearch] = useState("");
  const people = usePeople(scope, search);
  // Keep the chosen person selectable while the search results change.
  const [chosen, setChosen] = useState<ComboboxOption | null>(null);
  const items = chosen && !people.some((p) => p.value === chosen.value) ? [chosen, ...people] : people;
  const set = (patch: Partial<AuditFilterState>) => onChange({ ...value, ...patch });
  const groups = actionGroups.filter((g) => scope.kind === "platform" || !g.platform);
  const active = value.action || value.person || value.from || value.to;
  return (
    <div className={a.filters} role="group" aria-label="Filter the audit log">
      <Field label="Action" className={a.filter}>
        <NativeSelect size="sm" value={value.action} onChange={(e) => set({ action: e.target.value })}>
          <option value="">All actions</option>
          {groups.map((g) => (
            <option key={g.prefix} value={g.prefix}>
              {g.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Person" className={a.person}>
        <Combobox
          size="sm"
          items={items}
          value={value.person || null}
          onValueChange={(v, option) => {
            setChosen(option);
            set({ person: v ?? "" });
          }}
          onInputValueChange={setSearch}
          placeholder={scope.kind === "team" ? "Anyone" : "Search people"}
          emptyText="No matching people."
          clearable
          clearLabel="Clear person"
        />
      </Field>
      <Field label="From" className={a.date}>
        <Input size="sm" type="date" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
      </Field>
      <Field label="To" className={a.date}>
        <Input size="sm" type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
      </Field>
      {active && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setChosen(null);
            onChange(noAuditFilters);
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
