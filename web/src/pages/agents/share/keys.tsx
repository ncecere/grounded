/*
 * Publishable keys for the widget (team admins and owners, W8): a list whose
 * rows open the key in a FormPage (?form=<id>, or ?form=new to create one,
 * like every form page) with its allowed origins, limits, enable/disable and
 * revoke. Origins are shown as they will be saved, and one without a scheme
 * is named (F-08).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "../../../api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage, RelativeTime, timeColumn } from "@/components/templates/list-page";
import { FormPage, useFormParam } from "@/components/templates/form-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { toast } from "@/components/ui/toast/toast";
import { switchLabel } from "@/lib/terms";
import { useFormState } from "@/lib/use-form-state";
import s from "../../shared.module.css";
import { originProblem } from "./snippet";

export type PublishableKey = Schemas["PublishableKey"];
type Created = Schemas["PublishableKeyCreated"];

const keysKey = (team: string, agent: string) => ["team", team, "agent", agent, "publishable-keys"];

const columns: DataTableColumn<PublishableKey>[] = [
  { id: "name", header: "Key", accessor: "name", sortable: true, rowHeader: true, cell: (k) => <CellText primary={k.name} secondary={<span className={s.mono}>{k.keyPreview}</span>} /> },
  {
    id: "origins",
    header: "Allowed origins",
    accessor: (k) => k.allowedOrigins.join(", "),
    cell: (k) => (k.allowedOrigins.length ? <span className={s.mono}>{k.allowedOrigins.join(", ")}</span> : <span className={s.muted}>None: add one</span>),
  },
  { id: "status", header: "Status", accessor: (k) => switchLabel(k.enabled), cell: (k) => <StatusBadge tone={k.enabled ? "success" : "neutral"}>{switchLabel(k.enabled)}</StatusBadge> },
  timeColumn("lastUsedAt", "Last used", (k) => k.lastUsedAt),
];

type Props = { team: string; agentId: string; onCreated: (k: Created) => void };

export function KeysList({ team, agentId, onCreated }: Props) {
  const qc = useQueryClient();
  const form = useFormParam();
  const keys = useQuery({
    queryKey: keysKey(team, agentId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/publishable-keys", { params: { path: { team, agentId } } })),
  });
  const [revoking, setRevoking] = useState<PublishableKey | null>(null);
  const path = { team, agentId };
  const refresh = () => qc.invalidateQueries({ queryKey: keysKey(team, agentId) });
  const toggle = useMutation({
    mutationFn: async (k: PublishableKey) =>
      unwrap(await api.PATCH("/v1/teams/{team}/agents/{agentId}/publishable-keys/{keyId}", { params: { path: { ...path, keyId: k.id }, header: ifMatch(k.revision) }, body: { enabled: !k.enabled } })),
    onSuccess: (k) => {
      void refresh();
      toast.success(k.enabled ? `${k.name} is enabled` : `${k.name} is disabled: its widgets stop working`);
    },
  });
  const revoke = useMutation({
    mutationFn: async (k: PublishableKey) => unwrap(await api.DELETE("/v1/teams/{team}/agents/{agentId}/publishable-keys/{keyId}", { params: { path: { ...path, keyId: k.id } } })),
    onSuccess: () => {
      void refresh();
      setRevoking(null);
      if (form.id) form.close();
      toast.success("Key revoked");
    },
  });
  const list = keys.data ?? [];
  const open = form.id === "new" ? null : list.find((k) => k.id === form.id);
  const create = (
    <Button size="sm" variant="secondary" onClick={() => form.open("new")}>
      <Plus aria-hidden /> New widget key
    </Button>
  );
  return (
    <>
      <ErrorAlert error={toggle.error} />
      <ListPage<PublishableKey>
        id="agent-widget-keys"
        caption="Widget keys"
        columns={columns}
        data={list}
        getRowId={(k) => k.id}
        rowLabel={(k) => k.name}
        onRowClick={(k) => form.open(k.id)}
        rowActions={(k) => [
          { label: "View and edit", icon: <Pencil aria-hidden />, onSelect: () => form.open(k.id) },
          { label: k.enabled ? "Disable" : "Enable", icon: <Power aria-hidden />, onSelect: () => toggle.mutate(k) },
          { label: "Revoke…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setRevoking(k) },
        ]}
        loading={keys.isLoading}
        error={keys.error}
        onRetry={keys.refetch}
        empty={{ icon: <KeyRound />, title: "No widget keys yet.", description: "A key lets the widget run on the sites you allow.", action: create }}
        tableProps={{ toolbar: list.length > 0 ? create : undefined }}
      />
      {(form.id === "new" || open) && (
        <WidgetKeyForm
          key={form.id}
          team={team}
          agentId={agentId}
          current={open ?? null}
          onClose={form.close}
          onRevoke={open ? () => setRevoking(open) : undefined}
          onSaved={(k) => {
            void refresh();
            form.close();
            if ("key" in k) onCreated(k as Created);
          }}
        />
      )}
      <ConfirmMutationDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        mutation={revoke}
        onConfirm={(k) => revoke.mutate(k)}
        title={`Revoke ${revoking?.name ?? "this key"}?`}
        description="Widgets using it stop working at once, on every site. This can't be undone."
        confirmLabel="Revoke key"
        tone="danger"
      />
    </>
  );
}

type RecordProps = {
  team: string;
  agentId: string;
  current: PublishableKey | null;
  onClose: () => void;
  onRevoke?: () => void;
  onSaved: (k: PublishableKey | Created) => void;
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function WidgetKeyForm({ team, agentId, current, onClose, onRevoke, onSaved }: RecordProps) {
  const [form, set, , dirty] = useFormState({
    name: current?.name ?? "",
    origins: current?.allowedOrigins ?? [],
    perIp: current?.rateLimits.perIpPerMinute?.toString() ?? "",
    perSession: current?.rateLimits.perSessionPerMinute?.toString() ?? "",
  });
  // How each origin will be saved, or its problem, from the API (F-08).
  const checked = useQuery({
    queryKey: ["widget-origins", form.origins],
    queryFn: async () => unwrap(await api.POST("/v1/widget-origins/check", { body: { origins: form.origins } })),
    enabled: form.origins.length > 0,
    staleTime: Infinity,
  });
  const problems = checked.data
    ? checked.data.filter((c) => c.problem).map((c) => `${c.input}: ${c.problem}`)
    : (form.origins.map(originProblem).filter(Boolean) as string[]);
  const noScheme = (checked.data ?? []).filter((c) => c.origin && !/^[a-z]+:\/\//i.test(c.input));
  const badNumber = [form.perIp, form.perSession].some((v) => v.trim() !== "" && !/^\d+$/.test(v.trim()));
  const body = {
    name: form.name.trim(),
    allowedOrigins: form.origins,
    rateLimits: { perIpPerMinute: numOrNull(form.perIp), perSessionPerMinute: numOrNull(form.perSession) },
  };
  const save = useMutation({
    mutationFn: async (): Promise<PublishableKey | Created> =>
      current
        ? unwrap(await api.PATCH("/v1/teams/{team}/agents/{agentId}/publishable-keys/{keyId}", { params: { path: { team, agentId, keyId: current.id }, header: ifMatch(current.revision) }, body }))
        : unwrap(await api.POST("/v1/teams/{team}/agents/{agentId}/publishable-keys", { params: { path: { team, agentId } }, body })),
    onSuccess: onSaved,
  });
  return (
    <FormPage
      label={current ? current.name : "New widget key"}
      title={current ? current.name : "New widget key"}
      description="Only pages on the allowed origins can show the widget. The key sits in the page, so it isn't secret: origins, rate limits and daily caps protect the agent."
      facts={
        current
          ? [
              { label: "Key", value: <span className={s.mono}>{current.keyPreview}</span> },
              { label: "Status", value: <StatusBadge tone={current.enabled ? "success" : "neutral"}>{switchLabel(current.enabled)}</StatusBadge> },
              { label: "Last used", value: current.lastUsedAt ? <RelativeTime value={current.lastUsedAt} /> : "Never" },
              { label: "Created", value: <RelativeTime value={current.createdAt} /> },
            ]
          : undefined
      }
      onClose={onClose}
      dirty={dirty}
      onSubmit={() => save.mutate()}
      submitLabel={current ? "Save key" : "Create key"}
      busy={save.isPending}
      submitDisabled={!form.name.trim() || problems.length > 0 || badNumber}
      startActions={
        onRevoke && (
          <Button variant="danger" onClick={onRevoke}>
            <Trash2 aria-hidden /> Revoke
          </Button>
        )
      }
    >
      <Field label="Name" description="Where it is used, e.g. Main website.">
        <Input value={form.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field
        label="Allowed origins"
        description={
          noScheme.length
            ? `Add the scheme to be sure: ${noScheme.map((c) => `${c.input} will be saved as ${c.origin}`).join("; ")}.`
            : "Include the scheme, e.g. https://www.example.edu or http://localhost:8095, and press Enter after each. *.example.edu allows every subdomain."
        }
        error={problems[0]}
      >
        <TagInput value={form.origins} onValueChange={(v) => set("origins", v)} noun={{ one: "origin", other: "origins" }} maxTags={20} maxTagLength={253} placeholder="https://www.example.edu" />
      </Field>
      <div className={s.grid2}>
        <Field label="Questions per minute per address" labelHint="Optional" description="Empty: the platform default.">
          <Input inputMode="numeric" value={form.perIp} onChange={(e) => set("perIp", e.target.value)} />
        </Field>
        <Field label="Questions per minute per visitor" labelHint="Optional" description="Empty: the platform default.">
          <Input inputMode="numeric" value={form.perSession} onChange={(e) => set("perSession", e.target.value)} />
        </Field>
      </div>
      <ErrorAlert error={save.error} />
    </FormPage>
  );
}
