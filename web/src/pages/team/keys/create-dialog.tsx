/* Creating an API key; the secret is shown once, right after. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, unwrap } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Checkbox, CheckboxGroup } from "@/components/ui/checkbox/checkbox";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { membersKey } from "@/components/members";
import { useCurrentUser } from "@/session";
import { useAgents } from "../../agents/common";
import { type KB, keysKey, useTeam } from "../common";
import { type Kind, type Scope, allScopes, allowedScopes, mcpScopeDescription, scopeLabels } from "./scopes";

function endOfDay(date: string) {
  return new Date(date + "T23:59:59").toISOString();
}

type KeyForm = { name: string; kind: Kind; scopes: Scope[]; kbIds: string[]; agentIds: string[]; contact: string; expires: string };

export function CreateKeyDialog({ kbs, onClose }: { kbs: KB[]; onClose: () => void }) {
  const { slug, role } = useTeam();
  const qc = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState<KeyForm>({ name: "", kind: "personal", scopes: ["query"], kbIds: [], agentIds: [], contact: "", expires: "" });
  const chosen = form.scopes.filter((sc) => allowedScopes(role, form.kind).includes(sc));
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/api-keys", {
          params: { path: { team: slug } },
          body: {
            name: form.name.trim(),
            kind: form.kind,
            scopes: chosen,
            knowledgeBaseIds: form.kbIds.length ? form.kbIds : undefined,
            agentIds: form.agentIds.length ? form.agentIds : undefined,
            responsibleUserId: form.kind === "service" && form.contact ? form.contact : undefined,
            expiresAt: form.expires ? endOfDay(form.expires) : undefined,
          },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keysKey(slug) });
      toast.success("API key created");
    },
  });

  // One Dialog in both states, so it stays open (and keeps focus) when the secret appears.
  if (create.data) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="API key created" size="lg" footer={<Button onClick={onClose}>Done</Button>}>
        <SecretView secret={create.data.secret} team={slug} scopes={create.data.key.scopes} kbId={create.data.key.knowledgeBaseIds?.[0] ?? kbs[0]?.id} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New API key"
      description="The secret is shown once, right after the key is created."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={create.isPending} disabled={chosen.length === 0 || !form.name.trim()}>
            Create key
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <KeyFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} chosen={chosen} kbs={kbs} />
        <ErrorAlert error={create.error} />
      </Form>
    </Dialog>
  );
}

type KeyFieldsProps = { form: KeyForm; onChange: (patch: Partial<KeyForm>) => void; chosen: Scope[]; kbs: KB[] };

function KeyFields({ form, onChange, chosen, kbs }: KeyFieldsProps) {
  const { slug, role, isManager } = useTeam();
  const me = useCurrentUser();
  const agents = useAgents(slug);
  const members = useQuery({
    queryKey: membersKey(slug),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team: slug } } })),
    enabled: isManager && form.kind === "service",
  });
  const allowed = allowedScopes(role, form.kind);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <Field label="Name" description="What will use this key, for example “Course site search”.">
        <Input required maxLength={100} value={form.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      {isManager && (
        <Field label="Key type" description="Personal keys are revoked when you leave the team. Service keys belong to the team.">
          <NativeSelect value={form.kind} onChange={(e) => onChange({ kind: e.target.value as Kind })}>
            <option value="personal">Personal</option>
            <option value="service">Team service key</option>
          </NativeSelect>
        </Field>
      )}
      {form.kind === "service" && (
        <Field label="Responsible contact" description="The team member to ask about this key. Shown in the key list.">
          <NativeSelect value={form.contact || me.user.id} onChange={(e) => onChange({ contact: e.target.value })}>
            {(members.data ?? [{ user: me.user }]).map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.displayName || m.user.email}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <CheckboxGroup
        legend="Scopes"
        description={allowed.length < allScopes.length ? "Your team role limits which scopes you can grant." : undefined}
        value={chosen}
        onValueChange={(v) => onChange({ scopes: v as Scope[] })}
      >
        {allowed.map((sc) => (
          <Checkbox key={sc} value={sc} label={scopeLabels[sc]} description={sc === "mcp" ? mcpScopeDescription(me.capabilities.mcp) : undefined} />
        ))}
      </CheckboxGroup>
      {kbs.length > 0 && (
        <CheckboxGroup
          legend="Restrict to knowledge bases"
          description="Leave all unchecked to allow every knowledge base on the team."
          value={form.kbIds}
          onValueChange={(kbIds) => onChange({ kbIds })}
        >
          {kbs.map((kb) => (
            <Checkbox key={kb.id} value={kb.id} label={kb.name} />
          ))}
        </CheckboxGroup>
      )}
      {(agents.data ?? []).length > 0 && (
        <CheckboxGroup
          legend="Restrict to agents"
          description="Leave all unchecked to allow every agent on the team (the OpenAI-compatible endpoint and agent APIs)."
          value={form.agentIds}
          onValueChange={(agentIds) => onChange({ agentIds })}
        >
          {(agents.data ?? []).map((ag) => (
            <Checkbox key={ag.id} value={ag.id} label={ag.name} />
          ))}
        </CheckboxGroup>
      )}
      <Field label="Expires on" labelHint="Optional" description="The key stops working at the end of this day."
        validate={(v) => (v && String(v) < today ? "Choose today or a later date: a key can't expire in the past." : null)}
      >
        <Input type="date" min={today} value={form.expires} onChange={(e) => onChange({ expires: e.target.value })} />
      </Field>
    </>
  );
}

/** The secret once, with how to use it: a retrieve request for REST scopes, the MCP address for the mcp scope (docs/mcp.md). */
function SecretView({ secret, team, scopes, kbId }: { secret: string; team: string; scopes: Scope[]; kbId?: string }) {
  const origin = globalThis.location?.origin ?? "";
  const rest = scopes.some((sc) => sc !== "mcp");
  const curl = [
    `curl -X POST ${origin}/v1/teams/${team}/kbs/${kbId ?? "{kbId}"}/retrieve \\`,
    `  -H "Authorization: Bearer ${secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"query":"..."}'`,
  ].join("\n");
  return (
    <Stack gap={5}>
      <Alert tone="warning" title="Copy this key now.">
        It won't be shown again. Store it somewhere safe, such as a secrets manager. If you lose it, revoke it and create a new one.
      </Alert>
      <CopyField label="Secret" name="secret" value={secret} />
      {rest && <CopyField label="Example request" name="example request" value={curl} multiline />}
      {scopes.includes("mcp") && (
        <CopyField label="MCP server" name="MCP server address" value={`${origin}/mcp`} description="Give AI tools this address, with the key as a Bearer token." />
      )}
    </Stack>
  );
}
