/* Admin → Agents: assign or remove an agent's short name, /a/{short} (platform admins; audited), on the agent's record page. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, unwrap, type Schemas } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Field, Form } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import a from "./agents.module.css";

const shortRE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function ShortNameForm({ agent }: { agent: Schemas["AdminAgent"] }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(agent.shortName ?? "");
  const v = value.trim().toLowerCase();
  const invalid = v !== "" && !shortRE.test(v);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/v1/admin/agents/{agentId}/short-name", { params: { path: { agentId: agent.id } }, body: { shortName: v || null } })),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["admin", "agents"] });
      toast.success(res.shortName ? `${agent.name} is at /a/${res.shortName}` : `${agent.name} has no short name`);
    },
  });
  // The server's answer about the name itself (taken, reserved) belongs under the field.
  const fieldError = save.error instanceof ApiError && (save.error.status === 400 || save.error.status === 409) ? save.error.message : undefined;
  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && v !== (agent.shortName ?? "")) save.mutate();
      }}
    >
      <div className={a.shortForm}>
        <Field
          label="Short name"
          description="A short address, /a/{short name}, for everyone who may use the agent. 2-40 lowercase letters, digits or hyphens; leave empty to remove. Some names (admin, api, embed…) are reserved."
          error={invalid ? "Use 2-40 lowercase letters, digits or hyphens, starting with a letter or digit." : fieldError}
        >
          <Input
            value={value}
            maxLength={40}
            placeholder="registrar-help"
            onChange={(e) => {
              setValue(e.target.value);
              save.reset();
            }}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={invalid || v === (agent.shortName ?? "")}>
          Save short name
        </Button>
      </div>
      {!fieldError && <ErrorAlert error={save.error} />}
    </Form>
  );
}
