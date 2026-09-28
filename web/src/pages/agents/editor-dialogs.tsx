/* The agent editor's Enable/Disable and Delete dialogs. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "../../api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { agentKey, agentsKey, useTeam } from "../team/common";
import type { Agent } from "./common";
import type { AgentDraft } from "./draft";

export function StatusDialog({ agent, d, onClose }: { agent: Agent; d: AgentDraft; onClose: () => void }) {
  const { slug } = useTeam();
  const enabling = agent.status !== "active";
  const [reason, setReason] = useState("");
  const change = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/agents/{agentId}/status", {
          params: { path: { team: slug, agentId: agent.id } },
          body: enabling ? { status: "active" } : { status: "disabled_by_team", reason: reason.trim() || undefined },
        }),
      ),
    onSuccess: (next) => {
      d.adopt(next);
      toast.success(enabling ? `${agent.name} is enabled` : `${agent.name} is disabled`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={enabling ? `Enable ${agent.name}?` : `Disable ${agent.name}?`}
      description={enabling ? "Team members can chat with it again." : "Nobody can chat with it until it's enabled again. Conversations are kept."}
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button variant={enabling ? "primary" : "danger"} loading={change.isPending} onClick={() => change.mutate()}>
            {enabling ? "Enable agent" : "Disable agent"}
          </Button>
        </>
      }
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        {!enabling && (
          <Field label="Reason" labelHint="Optional" description="Shown to editors on this page.">
            <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <ErrorAlert error={change.error} />
      </Form>
    </Dialog>
  );
}

export function DeleteAgent({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/v1/teams/{team}/agents/{agentId}", { params: { path: { team: slug, agentId: agent.id } } })),
    onSuccess: () => {
      qc.removeQueries({ queryKey: agentKey(slug, agent.id) });
      qc.invalidateQueries({ queryKey: agentsKey(slug) });
      qc.invalidateQueries({ queryKey: ["agent-directory"] });
      toast.success(`${agent.name} was deleted`);
      void navigate({ to: "/teams/$team/agents", params: { team: slug } });
    },
  });
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) remove.reset();
      }}
      title={`Delete ${agent.name}?`}
      description="Nobody can chat with it any more. People keep read-only access to their own conversations with it. Its versions and analytics are kept for the audit trail."
      confirmLabel="Delete agent"
      busy={remove.isPending}
      error={remove.error}
      onConfirm={() => remove.mutate()}
    />
  );
}
