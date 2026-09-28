/* The platform kill switch: disable an agent for everyone (with a reason) or enable it again. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";

export function KillSwitchDialog({ agent, onClose }: { agent: Schemas["AdminAgent"]; onClose: () => void }) {
  const qc = useQueryClient();
  const enabling = agent.status === "disabled_by_platform";
  const [reason, setReason] = useState("");
  const tooShort = !enabling && reason.trim().length < 5;
  const change = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/agents/{agentId}/status", {
          params: { path: { agentId: agent.id } },
          body: enabling ? { status: "active", reason: reason.trim() || undefined } : { status: "disabled_by_platform", reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "agents"] });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast.success(enabling ? `${agent.name} is enabled` : `${agent.name} is disabled for everyone`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={enabling ? `Enable ${agent.name}?` : `Disable ${agent.name} for everyone?`}
      description={
        enabling
          ? `People on ${agent.teamName} can chat with it again (unless the team disabled it too).`
          : `Nobody can chat with it until a platform admin enables it again. ${agent.teamName} can't override this. The reason is shown to the team and audited.`
      }
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button variant={enabling ? "primary" : "danger"} loading={change.isPending} disabled={tooShort} onClick={() => change.mutate()}>
            {enabling ? "Enable agent" : "Disable agent"}
          </Button>
        </>
      }
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <Field label="Reason" labelHint={enabling ? "Optional" : undefined} description={enabling ? undefined : "At least 5 characters."}>
          <Textarea rows={3} maxLength={500} required={!enabling} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorAlert error={change.error} />
      </Form>
    </Dialog>
  );
}
