/*
 * Admin → Classifications (A8, DESIGN §4): each level with its settings
 * (widest audience, retention, allowed source types, direct /retrieve) and
 * its effect (models allowed, teams approved). Levels are edited on a form page (?form=).
 */
import { useFormParam } from "@/components/templates/form-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Tags } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "../../api/client";
import { ListPage } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import s from "../shared.module.css";
import { useClassifications, useIsPlatformAdmin } from "./hooks";
import { useModels } from "./models/common";
import m from "./models/models.module.css";
import { FormPage, FormSection } from "@/components/templates/form-page";

type Classification = Schemas["Classification"];
type Audience = Schemas["Audience"];
type SourceType = Classification["allowedSourceTypes"][number];

export const audienceLabels: Record<Audience, string> = {
  team: "Team only",
  all_authenticated: "Signed-in users",
  public: "Public (no sign-in)",
};
const sourceTypeLabels: Record<SourceType, string> = { upload: "Uploads", web: "Websites" };

/** "24 hours", "3 days". */
export const hoursText = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} ${h === 1 ? "hour" : "hours"}`);

/** Per level: enabled models allowed to process it, and active teams approved up to it. */
export function levelCounts(levels: Classification[], models: { maxClassification: string; enabled: boolean }[], teams: { maxClassification: string }[]) {
  const rank = new Map(levels.map((l) => [l.key, l.rank]));
  const at = (key: string) => rank.get(key) ?? -1;
  return new Map(
    levels.map((l) => [l.key, { models: models.filter((x) => x.enabled && at(x.maxClassification) >= l.rank).length, teams: teams.filter((t) => at(t.maxClassification) >= l.rank).length }]),
  );
}

export function ClassificationsPage() {
  const isAdmin = useIsPlatformAdmin();
  const levels = useClassifications();
  const models = useModels();
  const teams = useQuery({
    queryKey: ["admin", "teams", "active-all"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams", { params: { query: { status: "active", limit: 200 } } })),
  });
  // ?form=new or ?form=<level key>.
  const form = useFormParam();
  const list = levels.data ?? [];
  const editing: Classification | "new" | null = form.id === "new" ? "new" : (list.find((l) => l.key === form.id) ?? null);
  const setEditing = (l: Classification | "new") => form.open(l === "new" ? "new" : l.key);
  const counts = levelCounts(
    list,
    models.data ?? [],
    (teams.data?.items ?? []).map((t) => t.team),
  );
  const columns: DataTableColumn<Classification>[] = [
    { id: "level", header: "Level", accessor: "name", rowHeader: true, hideable: false, cell: (l) => <CellText className={m.levelCell} primary={l.name} secondary={l.description || undefined} /> },
    {
      id: "rank",
      header: "Rank",
      accessor: "rank",
      numeric: true,
      // In the Columns menu: the list is already in rank order, and the level fits at 1280 px without it.
      defaultHidden: true,
      cell: (l) => (
        <span className={s.muted} title="Fixed when the level is created">
          <Lock aria-hidden size={12} /> {l.rank}
        </span>
      ),
    },
    {
      id: "audience",
      header: "Widest audience",
      accessor: (l) => audienceLabels[l.maxAudience],
      cell: (l) => <Badge tone={l.maxAudience === "public" ? "success" : l.maxAudience === "team" ? "warning" : "info"}>{audienceLabels[l.maxAudience]}</Badge>,
    },
    {
      id: "retention",
      header: "Retention",
      accessor: (l) => l.conversationRetentionDays ?? 0,
      cell: (l) => (
        <CellText primary={l.conversationRetentionDays ? `${l.conversationRetentionDays} days` : "Until deleted"} secondary={`Anonymous: ${hoursText(l.anonymousRetentionHours)}`} />
      ),
    },
    { id: "sources", header: "Source types", accessor: (l) => l.allowedSourceTypes.join(", "), cell: (l) => l.allowedSourceTypes.map((t) => sourceTypeLabels[t]).join(", ") },
    { id: "retrieve", header: "API /retrieve", accessor: (l) => (l.directRetrieve ? "Allowed" : "Agents only"), muted: true },
    { id: "models", header: "Models allowed", accessor: (l) => counts.get(l.key)?.models ?? 0, numeric: true },
    { id: "teams", header: "Teams approved", accessor: (l) => counts.get(l.key)?.teams ?? 0, numeric: true },
  ];
  const add = isAdmin && (
    <Button onClick={() => setEditing("new")}>
      <Plus aria-hidden /> Add level
    </Button>
  );
  return (
    <>
      <ListPage<Classification>
        id="admin-classifications"
        title="Classifications"
        description="Levels set which models may process data, the widest audience an agent using it may have, how long conversations are kept and where the data may live. A more sensitive level can never allow a wider audience."
        primaryAction={add}
        caption="Classifications"
        columns={columns}
        data={list}
        getRowId={(l) => l.key}
        rowLabel={(l) => l.name}
        loading={levels.isLoading}
        error={levels.error}
        onRetry={() => void levels.refetch()}
        rowActions={(l) => [{ label: "Edit", icon: <Pencil aria-hidden />, hidden: !isAdmin, onSelect: () => setEditing(l) }]}
        empty={{ icon: <Tags />, title: "No classification levels yet." }}
        tableProps={{ defaultSort: { columnId: "rank", direction: "ascending" } }}
      />
      {isAdmin && editing && <ClassificationForm level={editing === "new" ? null : editing} onClose={form.close} />}
    </>
  );
}

function ClassificationForm({ level, onClose }: { level: Classification | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    key: level?.key ?? "",
    name: level?.name ?? "",
    description: level?.description ?? "",
    rank: level?.rank ?? 10,
    maxAudience: level?.maxAudience ?? ("team" as Audience),
    anonymousRetentionHours: String(level?.anonymousRetentionHours ?? 24),
    conversationRetentionDays: level?.conversationRetentionDays ? String(level.conversationRetentionDays) : "",
    allowedSourceTypes: level?.allowedSourceTypes ?? (["upload", "web"] as SourceType[]),
    directRetrieve: level?.directRetrieve ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const noTypes = form.allowedSourceTypes.length === 0;
  const save = useMutation({
    mutationFn: async () => {
      const settings = {
        anonymousRetentionHours: Number(form.anonymousRetentionHours) || 24,
        conversationRetentionDays: form.conversationRetentionDays ? Number(form.conversationRetentionDays) : 0,
        allowedSourceTypes: form.allowedSourceTypes,
        directRetrieve: form.directRetrieve,
      };
      if (level) {
        return unwrap(
          await api.PATCH("/v1/admin/classifications/{key}", {
            params: { path: { key: level.key }, header: ifMatch(level.revision) },
            body: { name: form.name, description: form.description, maxAudience: form.maxAudience, ...settings },
          }),
        );
      }
      const created = unwrap(
        await api.POST("/v1/admin/classifications", { body: { key: form.key, name: form.name, description: form.description, rank: form.rank, maxAudience: form.maxAudience } }),
      );
      return unwrap(await api.PATCH("/v1/admin/classifications/{key}", { params: { path: { key: created.key }, header: ifMatch(created.revision) }, body: settings }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["classifications"] });
      toast.success(level ? `${form.name} was saved` : `${form.name} was added`);
      onClose();
    },
  });
  const toggleType = (t: SourceType, on: boolean) => set("allowedSourceTypes", on ? [...form.allowedSourceTypes, t] : form.allowedSourceTypes.filter((x) => x !== t));
  return (
    <FormPage
      label={level ? `Edit ${level.name}` : "Add classification level"}
      title={level ? `Edit ${level.name}` : "Add classification level"}
      description="What data at this level may do. Changes apply to every team."
      onClose={onClose}
      onSubmit={() => !noTypes && save.mutate()}
      submitLabel={level ? "Save level" : "Add level"}
      busy={save.isPending}
      submitDisabled={noTypes}
    >
      <FormSection title="Level">
        {!level && (
          <>
            <Field label="Key" description="Lowercase letters, digits and underscores. Fixed once created.">
              <Input required pattern="[a-z][a-z0-9_]{1,31}" value={form.key} onChange={(e) => set("key", e.target.value)} />
            </Field>
            <Field label="Rank" description="Higher is more sensitive. Fixed once created.">
              <Input type="number" min={0} max={1000} required value={form.rank} onChange={(e) => set("rank", Number(e.target.value))} />
            </Field>
          </>
        )}
        <Field label="Name">
          <Input required maxLength={64} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Widest agent audience">
          <NativeSelect value={form.maxAudience} onChange={(e) => set("maxAudience", e.target.value as Audience)}>
            {Object.entries(audienceLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Description" labelHint="Optional" description="Your install's policy for this level, shown to teams." className={m.wide}>
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </FormSection>
      <FormSection title="Retention">
        <Field label="Signed-in conversations (days)" description="Deleted this long after their last activity. Empty keeps them until deleted.">
          <NumberInput
            maximumFractionDigits={0}
            min={1}
            max={36500}
            placeholder="Until deleted"
            value={form.conversationRetentionDays}
            onValueChange={(v) => set("conversationRetentionDays", v)}
          />
        </Field>
        <Field label="Anonymous conversations (hours)" description="Public-page and widget conversations.">
          <NumberInput maximumFractionDigits={0} min={1} max={876000} value={form.anonymousRetentionHours} onValueChange={(v) => set("anonymousRetentionHours", v)} />
        </Field>
      </FormSection>
      <FormSection title="Where the data may live">
        <Field
          label="Allowed source types"
          description="Checked when a source is created or reclassified."
          error={noTypes ? "Allow at least one source type." : undefined}
          className={m.wide}
        >
          <div className={s.badges}>
            {(Object.keys(sourceTypeLabels) as SourceType[]).map((t) => (
              <Checkbox key={t} label={sourceTypeLabels[t]} checked={form.allowedSourceTypes.includes(t)} onCheckedChange={(v) => toggleType(t, v)} />
            ))}
          </div>
        </Field>
        <Switch
          label="API keys may call /retrieve"
          description="When it's off, team API keys can only reach knowledge bases at this level through an agent."
          checked={form.directRetrieve}
          onCheckedChange={(v) => set("directRetrieve", v)}
        />
      </FormSection>
      <ErrorAlert error={save.error} />
    </FormPage>
  );
}
