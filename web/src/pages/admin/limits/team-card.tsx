/* One team's limit overrides (DESIGN.md §11.1), the Limits tab of the admin team page. Writes send If-Match. */
import { adminOnly } from "@/lib/terms";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { SettingsPage } from "@/components/templates/settings-page";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { formatLimit, formatLimitMax, teamLimitsQuery, teamOverridesQuery, toInput } from "@/lib/limits";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { AmountInput, LimitName } from "./fields";
import { LimitGroupAccordion, UsageCell, usedShare } from "./groups";
import { type OverrideForm, type OverrideMode, type OverrideRow, effectiveLimit, overrideChanges, overrideError, overrideForm, overrideInvalid, unsaved } from "./form";
import l from "./limits.module.css";

type TeamOverride = Schemas["TeamLimitOverride"];

/** The team's editable overrides: form state (reset when the team or revision changes), validation and save. */
function useTeamLimitsForm(team: string, teamName: string) {
  const qc = useQueryClient();
  const overrides = useQuery(teamOverridesQuery(team));
  const [form, setForm] = useState<OverrideForm | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const revision = overrides.data?.revision;
  useEffect(() => {
    if (overrides.data) setForm(overrideForm(overrides.data.items));
  }, [team, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = overrides.data?.items ?? [];
  const changes = overrideChanges(items, form);
  const invalid = overrideInvalid(items, form);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/admin/teams/{team}/limits", {
          params: { path: { team }, header: ifMatch(revision!) },
          body: { items: changes },
        }),
      ),
    onSuccess: (o) => {
      qc.setQueryData(teamOverridesQuery(team).queryKey, o);
      qc.invalidateQueries({ queryKey: ["team", team, "limits"] });
      setSubmitted(false);
      toast.success("Team limits saved", teamName);
    },
    onError: () => qc.invalidateQueries({ queryKey: teamOverridesQuery(team).queryKey }),
  });
  const discard = () => {
    setForm(overrideForm(items));
    setSubmitted(false);
    save.reset();
  };
  return { overrides, items, form, setForm, submitted, setSubmitted, changes, invalid, save, discard };
}

/** A team's limits (D7): the four groups as an accordion with Effective and Usage; inherit the default, set a value, or block. */
export function AdminTeamLimitsCard({ team, teamName }: { team: string; teamName: string }) {
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const usage = useQuery(teamLimitsQuery(team));
  const { overrides, items, form, setForm, submitted, setSubmitted, changes, invalid, save, discard } = useTeamLimitsForm(team, teamName);
  const used = new Map((usage.data?.items ?? []).map((u) => [u.key, u]));

  if (overrides.isLoading || !form) return overrides.error ? <ErrorAlert error={overrides.error} /> : <Loading label="Loading team limits…" />;
  return (
    <SettingsPage
      dirty={changes.length > 0 || invalid}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save team limits"
      message={invalid ? "Not saved: fix the highlighted limit" : unsaved(changes.length)}
      saveDisabled={submitted && invalid}
      onSave={() => {
        setSubmitted(true);
        if (!invalid && changes.length > 0) save.mutate();
      }}
      onDiscard={discard}
    >
      <p className={l.intro}>
        Inherit uses the platform default; Blocked sets 0. A team's value can't exceed the ceiling. Defaults and ceilings are on the{" "}
        <TextLink render={<Link to="/admin/limits" />}>Limits</TextLink> page.
      </p>
      <LimitGroupAccordion
        items={items}
        meta={(group) => groupMeta(group, used)}
        render={(group, g) => (
          <Table
            caption={`${g.label} limits for ${teamName}`}
            columns={["Limit", { label: "Default", width: "9rem" }, { label: "Team value", width: "19rem" }, { label: "Effective", width: "8rem" }, { label: "Usage", width: "12rem" }]}
          >
            {group.map((it) => (
              <OverrideRowView
                key={it.key}
                it={it}
                f={form[it.key]!}
                usage={used.get(it.key)}
                isAdmin={isAdmin}
                submitted={submitted}
                onChange={(row) => setForm({ ...form, [it.key]: row })}
              />
            ))}
          </Table>
        )}
      />
      {isAdmin && submitted && invalid && <Alert tone="danger">Fix the highlighted limits, then save.</Alert>}
    </SettingsPage>
  );
}

/** "2 overrides · 1 near limit" for a group's header. */
function groupMeta(group: TeamOverride[], used: Map<string, Schemas["TeamLimit"]>) {
  const overridden = group.filter((it) => it.override !== null).length;
  const near = group.filter((it) => usedShare(used.get(it.key)) >= 0.8).length;
  return [overridden ? `${overridden} ${overridden === 1 ? "override" : "overrides"}` : "", near ? `${near} near the limit` : ""].filter(Boolean).join(" · ") || undefined;
}

type RowProps = { it: TeamOverride; f: OverrideRow; usage?: Schemas["TeamLimit"]; isAdmin: boolean; submitted: boolean; onChange: (row: OverrideRow) => void };

function OverrideRowView({ it, f, usage, isAdmin, submitted, onChange }: RowProps) {
  // A typed value is checked as you go (F-05); an empty one only on save.
  const err = submitted || f.value.trim() !== "" ? overrideError(it, f) : undefined;
  return (
    <Tr>
      <Td>
        <LimitName label={it.label} description={it.description} />
      </Td>
      <Td muted>
        {formatLimitMax(it, it.default)}
        {it.ceiling !== null && <span className={s.secondary}>Ceiling {formatLimit(it.unit, it.period, it.ceiling)}</span>}
      </Td>
      <Td>
        {isAdmin ? (
          <div className={l.override}>
            <Field label={`${it.label}: team setting`} hideLabel className={l.modeField}>
              <NativeSelect size="sm" value={f.mode} onChange={(e) => onChange({ ...f, mode: e.target.value as OverrideMode })}>
                <option value="inherit">Inherit</option>
                <option value="custom">Custom value</option>
                <option value="blocked">Blocked</option>
              </NativeSelect>
            </Field>
            {f.mode === "custom" && (
              <AmountInput
                label={`${it.label}: team value`}
                unit={it.unit}
                period={it.period}
                value={f.value}
                placeholder={toInput(it.unit, it.default) || "Amount"}
                error={err}
                onChange={(v) => onChange({ ...f, value: v })}
              />
            )}
          </div>
        ) : it.override === null ? (
          <span className={s.muted}>Inherits</span>
        ) : (
          formatLimit(it.unit, it.period, it.override)
        )}
      </Td>
      <Td>
        {formatLimit(it.unit, it.period, effectiveLimit(it, f))}
        {it.override !== null && it.ceiling !== null && it.override > it.ceiling && (
          <span className={s.secondary}>
            <Badge tone="warning" size="sm">
              Capped by the ceiling
            </Badge>
          </span>
        )}
      </Td>
      <Td>
        <UsageCell limit={usage} label={it.label} />
      </Td>
    </Tr>
  );
}
