/*
 * Admin → Personal data (docs/pii-scanning.md; route /admin/personal-data): scanning documents for possible personal
 * data at ingest. On by default and flag-only: a document with findings is indexed, with what was found and on which
 * pages, and waits for an editor's review. Classification levels chosen here hold such documents out of the index
 * until an editor approves them. Platform admins add their institution's own formats as patterns; auditors read.
 * Outside the form, the teams with documents waiting for a review (counts only).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { ListPage } from "@/components/templates/list-page";
import { useRevisionForm } from "@/components/templates/revision-form";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Checkbox, CheckboxGroup } from "@/components/ui/checkbox/checkbox";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Switch } from "@/components/ui/switch/switch";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { MAX_PATTERNS, patternProblems, piiChanges, piiForm, piiInput, type PatternProblem, type PiiForm, type PiiSettings } from "@/lib/pii";
import { adminOnly } from "@/lib/terms";
import s from "../../shared.module.css";
import { useClassifications, useIsPlatformAdmin } from "../hooks";
import p from "./personal-data.module.css";

export const piiKey = ["admin", "pii"];

export function PersonalDataPage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useQuery({ queryKey: piiKey, queryFn: async () => unwrap(await api.GET("/v1/admin/pii")) });
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Personal data"
        description="Grounded looks for possible personal data in each document it indexes and asks the team to review what it finds. It records the kind, how many and on which pages, never the data itself."
      />
      <QueryView query={settings} loadingLabel="Loading personal data settings…">
        {settings.data && (
          <>
            <PiiEditor saved={settings.data} isAdmin={isAdmin} />
            <ReviewSection items={settings.data.review} />
          </>
        )}
      </QueryView>
    </Stack>
  );
}

function PiiEditor({ saved, isAdmin }: { saved: PiiSettings; isAdmin: boolean }) {
  const qc = useQueryClient();
  const levels = useClassifications().data ?? [];
  const [form, setForm, revision] = useRevisionForm(piiForm(saved), saved.revision, {
    labels: { enabled: "Scanning", blockLevels: "Held for review", patterns: "Your patterns" },
    format: (key, v) =>
      key === "enabled" ? (v ? "On" : "Off") : key === "patterns" ? (v as PiiForm["patterns"]).map((x) => x.name).join(", ") || "None" : (v as string[]).join(", ") || "None",
  });
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async (f: PiiForm) => unwrap(await api.PUT("/v1/admin/pii", { params: { header: ifMatch(saved.revision) }, body: piiInput(f) })),
    onSuccess: (st) => {
      qc.setQueryData(piiKey, st);
      toast.success("Personal data settings saved");
      setForm(piiForm(st));
      setSubmitted(false);
    },
  });
  const problems = patternProblems(form);
  // The server checks each expression (RE2): its answer goes on the row it names.
  const serverIndex = save.error instanceof ApiError && save.error.code === "invalid_pattern" ? Number((save.error.details as { index?: number } | undefined)?.index ?? -1) : -1;
  const badExpression: PatternProblem = { field: "pattern", message: "Grounded can't use this expression: check it is a valid RE2 regular expression that doesn't match empty text." };
  const shown: Record<number, PatternProblem> = { ...(submitted ? problems : {}), ...(serverIndex >= 0 ? { [serverIndex]: badExpression } : {}) };
  const invalid = submitted && Object.keys(problems).length > 0;
  const changes = piiChanges(saved, form);
  const set = (patch: Partial<PiiForm>) => (save.reset(), setForm((f) => ({ ...f, ...patch })));
  const setPattern = (i: number, patch: Partial<PiiForm["patterns"][number]>) => set({ patterns: form.patterns.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <SettingsPage
      revision={revision}
      dirty={changes > 0}
      canEdit={isAdmin}
      readOnlyNote={adminOnly}
      saving={save.isPending}
      error={serverIndex >= 0 ? undefined : save.error}
      saveLabel="Save settings"
      message={serverIndex >= 0 ? "Not saved: fix the pattern." : invalid ? `Not saved: ${Object.values(problems)[0]?.message}` : changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      onSave={() => {
        setSubmitted(true);
        if (Object.keys(problems).length === 0) save.mutate(form);
      }}
      onDiscard={() => {
        setForm(piiForm(saved));
        setSubmitted(false);
        save.reset();
      }}
    >
      <SettingsSection
        title="Scanning"
        description="Changes apply to documents processed from now on. Documents already indexed keep their flags until they are processed again."
        actions={<StatusBadge tone={form.enabled ? "success" : "neutral"}>{form.enabled ? "On" : "Off"}</StatusBadge>}
      >
        <Switch
          label="Look for possible personal data in new and changed documents"
          description="A document with findings is still indexed. Its source shows what was found, and the team's editors review it from Needs attention."
          checked={form.enabled}
          disabled={!isAdmin}
          onCheckedChange={(v) => set({ enabled: v })}
        />
        <DescriptionList
          items={[
            { label: "US Social Security numbers", value: "Written as 123-45-6789 or 123 45 6789. Numbers that can't be issued, such as 000, 666 or 9xx areas, and well-known sample numbers are ignored." },
            { label: "Payment card numbers", value: "13 to 19 digits from a known card network that pass the card checksum (Luhn)." },
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Hold for review" description="For sources at these classification levels, a document with findings stays out of search until an editor approves it.">
        <CheckboxGroup legend="Classification levels" value={form.blockLevels} onValueChange={(v) => set({ blockLevels: [...(v as string[])].sort() })} disabled={!isAdmin || !form.enabled}>
          {levels.map((l) => (
            <Checkbox key={l.key} value={l.key} label={l.name} description={l.description} />
          ))}
        </CheckboxGroup>
      </SettingsSection>
      <SettingsSection
        title="Your patterns"
        description={`Your institution's own formats, such as student or employee IDs, as regular expressions (RE2 syntax). At most ${MAX_PATTERNS}. The audit log records their names, not the expressions.`}
      >
        {form.patterns.length === 0 && <p className={s.muted}>No patterns yet.</p>}
        {form.patterns.map((row, i) => (
          <div key={i} className={p.patternRow} role="group" aria-label={`Pattern ${i + 1}`}>
            <Field label="Name" error={shown[i]?.field === "name" ? shown[i].message : undefined}>
              <Input disabled={!isAdmin} value={row.name} maxLength={60} onChange={(e) => setPattern(i, { name: e.target.value })} placeholder="Student ID" />
            </Field>
            <Field label="Regular expression" error={shown[i]?.field === "pattern" ? shown[i].message : undefined}>
              <Input disabled={!isAdmin} value={row.pattern} maxLength={500} spellCheck={false} className={p.mono} onChange={(e) => setPattern(i, { pattern: e.target.value })} placeholder="\bU\d{8}\b" />
            </Field>
            {isAdmin && (
              <Button variant="ghost" iconOnly aria-label={`Remove pattern ${row.name || i + 1}`} className={p.remove} onClick={() => set({ patterns: form.patterns.filter((_, j) => j !== i) })}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {isAdmin && (
          <div>
            <Button variant="secondary" size="sm" disabled={form.patterns.length >= MAX_PATTERNS} onClick={() => set({ patterns: [...form.patterns, { name: "", pattern: "" }] })}>
              <Plus aria-hidden /> Add pattern
            </Button>
          </div>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

type ReviewRow = Schemas["PiiReviewCount"];

const columns: DataTableColumn<ReviewRow>[] = [
  {
    id: "team",
    header: "Team",
    rowHeader: true,
    accessor: (r) => r.teamName,
    cell: (r) => <CellText primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: r.team }} />}>{r.teamName}</TextLink>} secondary={r.team} />,
  },
  { id: "held", header: "Held for review", accessor: (r) => r.held, numeric: true, cell: (r) => r.held.toLocaleString() },
  { id: "flagged", header: "Indexed, waiting for review", accessor: (r) => r.flagged, numeric: true, cell: (r) => r.flagged.toLocaleString() },
];

function ReviewSection({ items }: { items: ReviewRow[] }) {
  return (
    <Card
      id="waiting-for-review"
      title="Waiting for review"
      description="Documents with possible personal data, by team, as counts only: each team's editors review their own documents."
      flush
    >
      <ListPage<ReviewRow>
        id="admin-pii-review"
        caption="Teams with documents waiting for a personal data review"
        columns={columns}
        data={items}
        getRowId={(r) => r.team}
        rowLabel={(r) => r.teamName}
        empty={{ icon: <FileCheck2 />, title: "No documents are waiting for a review." }}
      />
    </Card>
  );
}
