/* Placing and releasing legal holds (platform admins; both audited). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { TeamPicker } from "../team-picker";
import { retentionKey } from "./settings";
import { conversationIdOf, scopeHelp, scopeTypeLabels } from "./labels";
import r from "./retention.module.css";

type Hold = Schemas["LegalHold"];
type ScopeType = Schemas["LegalHoldScopeType"];

export const holdsKey = ["admin", "legal-holds"];
const maxReason = 2000;

type Form = { scopeType: ScopeType; scope: string; reason: string; from: string; to: string };

/** Field errors of the place-a-hold form. */
export function holdProblems(f: Form): Partial<Record<keyof Form, string>> {
  const out: Partial<Record<keyof Form, string>> = {};
  if (!f.scope.trim()) out.scope = f.scopeType === "team" ? "Choose a team." : "Say what the hold covers.";
  else if (f.scopeType === "conversation" && !conversationIdOf(f.scope))
    out.scope = "That isn't a conversation link or ID. Paste the link from the conversation's address bar.";
  if (!f.reason.trim()) out.reason = "Give the reason for the hold, such as the matter or request it's for.";
  if (f.from && f.to && f.to < f.from) out.to = "The last day must be on or after the first.";
  return out;
}

/** What the API is sent: a pasted conversation link becomes its ID. */
const scopeValue = (f: Form) => (f.scopeType === "conversation" ? (conversationIdOf(f.scope) ?? f.scope.trim()) : f.scope.trim());

export function PlaceHoldDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>({ scopeType: "team", scope: "", reason: "", from: "", to: "" });
  const [submitted, setSubmitted] = useState(false);
  const problems = submitted ? holdProblems(form) : {};
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const place = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/legal-holds", {
          body: { scopeType: form.scopeType, scope: scopeValue(form), reason: form.reason.trim(), coversFrom: form.from || null, coversTo: form.to || null },
        }),
      ),
    onSuccess: (h) => {
      void qc.invalidateQueries({ queryKey: holdsKey });
      void qc.invalidateQueries({ queryKey: retentionKey });
      toast.success(`Hold placed on ${h.scopeLabel}`, "Retention keeps what it covers from the next batch.");
      onClose();
    },
  });
  const help = scopeHelp[form.scopeType];
  return (
    <FormDialog
      title="Place a legal hold"
      description="Retention stops deleting what the hold covers until a platform admin releases it."
      onClose={onClose}
      submitLabel="Place hold"
      busy={place.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(holdProblems(form)).length === 0) place.mutate();
      }}
    >
      <Field label="Covers">
        <NativeSelect value={form.scopeType} onChange={(e) => set({ scopeType: e.target.value as ScopeType, scope: "" })}>
          {(Object.keys(scopeTypeLabels) as ScopeType[]).map((t) => (
            <option key={t} value={t}>
              {scopeTypeLabels[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={help.label} description={help.description} error={problems.scope}>
        {form.scopeType === "team" ? (
          <TeamPicker value={form.scope} onChange={(scope) => set({ scope })} />
        ) : (
          <Input aria-required autoComplete="off" spellCheck={false} placeholder={help.placeholder} value={form.scope} onChange={(e) => set({ scope: e.target.value })} />
        )}
      </Field>
      <Field label="Reason" description={`Required. Recorded in the audit log. Up to ${maxReason} characters.`} error={problems.reason}>
        <Textarea aria-required rows={3} maxLength={maxReason} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
      </Field>
      <div className={r.dates}>
        <Field label="Data from" labelHint="Optional" description="First day (UTC)">
          <Input type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="Data until" labelHint="Optional" description="Last day (UTC)" error={problems.to}>
          <Input type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>
      <Alert tone="info" title="What a hold covers">
        Conversations (including ones their users delete: they're hidden from them but kept), analytics and usage events, the access log, audit entries, deleted
        documents&apos; files and expired invites. Nobody is notified; team members and admins never see holds.
      </Alert>
      <ErrorAlert error={place.error} />
    </FormDialog>
  );
}

export function ReleaseHoldDialog({ hold, onClose }: { hold: Hold; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const release = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/admin/legal-holds/{holdId}/release", { params: { path: { holdId: hold.id } }, body: { reason: reason.trim() } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: holdsKey });
      toast.success("Hold released", "Retention deletes what's past its period at the next run.");
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Release the hold on ${hold.scopeLabel}?`}
      description="Retention then deletes what the hold kept, if its period has passed, at the next run. This can't be undone."
      onClose={onClose}
      submitLabel="Release hold"
      busy={release.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (reason.trim()) release.mutate();
      }}
    >
      {hold.deletedConversations > 0 && (
        <Alert tone="warning" title={`${hold.deletedConversations.toLocaleString()} conversations deleted by their users`}>
          They are removed for good at the next run if their grace period has passed.
        </Alert>
      )}
      <Field label="Why release it" description="Required. Recorded in the audit log." error={submitted && !reason.trim() ? "Give the reason for releasing the hold." : undefined}>
        <Textarea aria-required rows={3} maxLength={maxReason} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorAlert error={release.error} />
    </FormDialog>
  );
}
