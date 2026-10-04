/*
 * Team limits administration (DESIGN.md §11.1): platform defaults and
 * ceilings. Writes send If-Match so two admins can't overwrite each other.
 * One team's overrides are a card on the admin team page (team-card.tsx).
 */
import { Boxes, ClipboardCheck, Globe, MessagesSquare, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Form } from "@/components/ui/field/field";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { UnsavedChangesGuard } from "@/components/templates/unsaved-guard";
import { SaveBar } from "@/components/ui/save-bar/save-bar";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { formatDate } from "@/lib/format";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { formatLimit, formatLimitMax, limitGroups, platformLimitsQuery } from "@/lib/limits";
import { limitTabs } from "@/lib/tabs";
import { adminOnly } from "@/lib/terms";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { AmountInput, LimitName } from "./fields";
import { inGroup } from "./groups";
import { type PlatformForm, type PlatformRow, platformChanges, platformErrors, platformForm, platformInvalid, unsaved } from "./form";
import l from "./limits.module.css";
import { EvaluationsNote } from "./evaluations-note";

type PlatformLimit = Schemas["PlatformLimit"];

/** The editable platform limits: form state (reset when the server revision changes), validation and save. */
function usePlatformLimitsForm() {
  const qc = useQueryClient();
  const limits = useQuery(platformLimitsQuery());
  const [form, setForm] = useState<PlatformForm | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const revision = limits.data?.revision;
  useEffect(() => {
    if (limits.data) setForm(platformForm(limits.data.items));
    // Reset only when the server's revision changes (after a save or a
    // conflict), not on every background refetch.
  }, [revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = limits.data?.items ?? [];
  const changes = platformChanges(items, form);
  const invalid = platformInvalid(items, form);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/v1/admin/limits", { params: { header: ifMatch(revision!) }, body: { items: changes } })),
    onSuccess: (p) => {
      qc.setQueryData(platformLimitsQuery().queryKey, p);
      qc.invalidateQueries({ queryKey: ["admin", "team"] });
      setSubmitted(false);
      toast.success("Limits saved", savedText(changes.length, p.items));
    },
    onError: () => qc.invalidateQueries({ queryKey: platformLimitsQuery().queryKey }),
  });
  const discard = () => {
    setForm(platformForm(items));
    setSubmitted(false);
    save.reset();
  };
  return { limits, items, form, setForm, submitted, setSubmitted, changes, invalid, save, discard };
}

const limitGroupIcons = {
  resources: <Boxes aria-hidden />,
  ingestion: <Upload aria-hidden />,
  queries: <MessagesSquare aria-hidden />,
  public: <Globe aria-hidden />,
  evaluations: <ClipboardCheck aria-hidden />,
} as const;

export function LimitsPage() {
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const formId = useId();
  const [tab, setTab] = useUrlTab(limitTabs);
  const { limits, items, form, setForm, submitted, setSubmitted, changes, invalid, save, discard } = usePlatformLimitsForm();
  // Groups (tabs) holding a limit that doesn't validate, named in the error so hidden tabs aren't missed.
  const badGroups = form && submitted ? limitGroups.filter((g) => items.some((it) => it.group === g.key && Object.keys(platformErrors(it, form[it.key]!)).length > 0)) : [];

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Limits"
        description="Defaults apply to every team without its own value; a ceiling is the most any team can be given (lowering it caps existing team values). Empty means unlimited or no ceiling, or a limit's maximum where Grounded has one. A team's own values are on its page under Teams."
        meta={limits.data && limits.data.revision > 1 ? <span className={s.note}>Last changed {formatDate(limits.data.updatedAt)}</span> : undefined}
      />
      {!isAdmin && (
        <Alert tone="info" title="Read-only">
          {adminOnly}
        </Alert>
      )}
      {limits.isLoading || !form ? (
        limits.error ? (
          <ErrorAlert error={limits.error} title="Couldn't load limits" />
        ) : (
          <Loading label="Loading limits…" />
        )
      ) : (
        <Form
          id={formId}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (!invalid && changes.length > 0) save.mutate();
          }}
        >
          <div className={l.saveAlerts}>
            <ApiErrorAlert error={save.error} />
            {badGroups.length > 0 && <Alert tone="danger">Fix the highlighted limits in {badGroups.map((g) => g.label).join(", ")}, then save.</Alert>}
          </div>
          <PageTabs
            label="Limit groups"
            value={tab}
            onValueChange={setTab}
            tabs={limitGroups.map((g) => ({
              value: g.key,
              label: g.label,
              icon: limitGroupIcons[g.key],
              content: (
                <Stack gap={4}>
                  <Card title={g.label} description={g.description} flush>
                    <Table caption={`${g.label}: defaults and ceilings`} columns={["Limit", { label: "Default", width: "15rem" }, { label: "Ceiling", width: "15rem" }]}>
                      {inGroup(items, g.key).map((it) => (
                        <PlatformLimitRow key={it.key} it={it} f={form[it.key]!} isAdmin={isAdmin} submitted={submitted} onChange={(row) => setForm({ ...form, [it.key]: row })} />
                      ))}
                    </Table>
                  </Card>
                  {g.key === "evaluations" && <EvaluationsNote />}
                </Stack>
              ),
            }))}
          />
          {isAdmin && (
            <SaveBar open={changes.length > 0 || invalid} message={invalid ? "Not saved: fix the highlighted limits" : unsaved(changes.length)}>
              <Button variant="ghost" disabled={save.isPending} onClick={discard}>
                Discard
              </Button>
              <Button type="submit" loading={save.isPending}>
                Save limits
              </Button>
              {/* Asks before leaving with unsaved changes (the dialog is portalled). */}
              <UnsavedChangesGuard dirty={changes.length > 0 || invalid} />
            </SaveBar>
          )}
        </Form>
      )}
    </Stack>
  );
}

type RowProps = { it: PlatformLimit; f: PlatformRow; isAdmin: boolean; submitted: boolean; onChange: (row: PlatformRow) => void };

function PlatformLimitRow({ it, f, isAdmin, submitted, onChange }: RowProps) {
  // Errors show as you type (F-05), not only after Save.
  const errs = submitted || invalidTyped(f) ? platformErrors(it, f) : {};
  return (
    <Tr>
      <Td>
        <LimitName label={it.label} description={it.description}>
          {it.custom && <span className={s.secondary}>Built-in default: {formatLimit(it.unit, it.period, it.builtInDefault)}</span>}
        </LimitName>
      </Td>
      <Td>
        {isAdmin ? (
          <AmountInput
            label={`Default for ${it.label}`}
            unit={it.unit}
            period={it.period}
            value={f.def}
            placeholder={formatLimitMax(it, null)}
            error={errs.def}
            onChange={(v) => onChange({ ...f, def: v })}
          />
        ) : (
          formatLimitMax(it, it.default)
        )}
      </Td>
      <Td>
        {isAdmin ? (
          <AmountInput
            label={`Ceiling for ${it.label}`}
            unit={it.unit}
            period={it.period}
            value={f.ceil}
            placeholder={formatLimitMax(it, null, "No ceiling")}
            error={errs.ceil}
            onChange={(v) => onChange({ ...f, ceil: v })}
          />
        ) : it.ceiling === null && it.max === undefined ? (
          <span className={s.muted}>No ceiling</span>
        ) : (
          formatLimitMax(it, it.ceiling)
        )}
        {it.capped.length > 0 && <span className={s.secondary}>Caps {it.capped.map((c) => c.teamName).join(", ")}</span>}
      </Td>
    </Tr>
  );
}

/** What a save changed, naming the teams a ceiling now caps (AD-14): "No override" isn't the whole story. */
export function savedText(changed: number, items: { label: string; capped: { teamName: string }[] }[]) {
  const first = `${changed === 1 ? "1 limit" : `${changed} limits`} changed for every team without its own value.`;
  const capped = items.filter((it) => it.capped.length > 0).map((it) => `${it.label}: ${it.capped.map((c) => c.teamName).join(", ")}`);
  return capped.length ? `${first} Capped by the ceiling: ${capped.join("; ")}.` : first;
}

/** A row with typed (non-empty) values, checked before Save. */
function invalidTyped(f: PlatformRow) {
  return Object.values(f).some((v) => typeof v === "string" && v.trim() !== "");
}
