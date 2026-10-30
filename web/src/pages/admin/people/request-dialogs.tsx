/* The team request queue's dialogs: approving (creates the team), declining (a reason the person reads) and viewing a request. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, ifMatch, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { Alert } from "@/components/ui/alert/alert";
import { FormDialog } from "@/components/form-dialog";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { slugFromName } from "@/lib/slug";
import { useAgentTemplates } from "../../agents/templates";
import { useClassificationLevels } from "../../team/common";
import { type AdminTeamRequest, RequestStatusBadge, adminTeamRequestsKey, standingClassification, statusLabels } from "../../team-requests/common";

const slugRE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** What every decision changes: the queue, the sidebar's count, the team list (an approval adds a team). */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: adminTeamRequestsKey });
    void qc.invalidateQueries({ queryKey: ["admin", "attention"] });
    void qc.invalidateQueries({ queryKey: ["admin", "teams"] });
  };
}

/**
 * Someone else decided the request first (409 request_already_decided, or 412 for a changed revision): the queue
 * refreshes, the dialog closes (docs/administration/team-requests) and a toast says why, instead of leaving an open
 * dialog with an error and a button that cannot work. Other errors stay in the dialog.
 */
function useDecidedElsewhere(request: AdminTeamRequest, onClose: () => void) {
  const refresh = useRefresh();
  return (e: unknown) => {
    if (!(e instanceof ApiError && (e.status === 412 || e.code === "request_already_decided"))) return;
    refresh();
    toast.info(`"${request.name}" was already decided`, "Someone else decided it, or the person withdrew it. The queue shows where it stands.");
    onClose();
  };
}

export function ApproveDialog({ request, onClose }: { request: AdminTeamRequest; onClose: () => void }) {
  const refresh = useRefresh();
  const levels = useClassificationLevels();
  const templates = useAgentTemplates();
  const [name, setName] = useState(request.name);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [classification, setClassification] = useState(request.classification);
  const [starter, setStarter] = useState("");
  const [otherOwner, setOtherOwner] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const shownSlug = slugEdited ? slug : slugFromName(name);
  const asked = request.ownerEmail || request.requesterEmail;
  const decidedElsewhere = useDecidedElsewhere(request, onClose);
  const [refused, setRefused] = useState(false);
  const approve = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/team-requests/{requestId}/approve", {
          params: { path: { requestId: request.id }, header: ifMatch(request.revision) },
          body: { slug: shownSlug, name: name.trim(), maxClassification: classification, ownerEmail: otherOwner.trim() || undefined, starterTemplateId: starter || undefined },
        }),
      ),
    onSuccess: (r) => {
      refresh();
      toast.success(`"${r.teamName}" was created`, `${otherOwner.trim() || asked} is its owner.`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "owner_suspended") setRefused(true);
      decidedElsewhere(e);
    },
  });
  const taken = approve.error instanceof ApiError && approve.error.code === "slug_taken";
  // A suspended person cannot own a team (the server refuses, 409 owner_suspended): the reviewer is told before they fill the dialog in, and
  // names someone else. The refusal also shows the field when the account was suspended after the queue loaded, or the person named is.
  const needsOwner = request.ownerSuspended || refused;
  const serverRefusedOwner = approve.error instanceof ApiError && approve.error.code === "owner_suspended";
  const named = otherOwner.trim();
  const ownerError = !needsOwner
    ? undefined
    : !named
      ? `Enter the email of ${request.ownerSuspended ? "a different owner" : "an owner"}.`
      : request.ownerSuspended && named.toLowerCase() === asked.toLowerCase()
        ? `${asked} is the suspended account. Choose a different owner.`
        : serverRefusedOwner
          ? "That account is suspended too. Choose a different owner."
          : undefined;
  const slugError = !slugRE.test(shownSlug) ? "Use lower-case letters, digits and hyphens." : taken ? "A team with that address already exists." : undefined;
  const nameError = !name.trim() ? "Enter a name." : undefined;
  return (
    <FormDialog
      size="lg"
      title={`Approve "${request.name}"`}
      description="This creates the team now. The person who asked is told."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (!slugError && !nameError && !ownerError) approve.mutate();
      }}
      submitLabel="Approve and create the team"
      busy={approve.isPending}
      formProps={{ noValidate: true }}
    >
      {needsOwner && (
        <Alert tone="warning" title="The owner's account is suspended">
          {request.ownerSuspended ? asked : "The person named as owner"} is suspended and cannot sign in, so a team they alone owned would have no one to run it. Choose a different owner to approve this request, or decline it.
        </Alert>
      )}
      <Field label="Team name" error={submitted ? nameError : undefined}>
        <Input aria-required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Address" description={`The team's address: /teams/${shownSlug || "…"}. The request has none, so choose one.`} error={submitted || taken ? slugError : undefined}>
        <Input
          aria-required
          maxLength={63}
          spellCheck={false}
          value={shownSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
            approve.reset();
          }}
        />
      </Field>
      <Field label="Highest classification" description="The most sensitive data the team may hold. The person asked for the level shown first.">
        <NativeSelect value={classification} onChange={(e) => setClassification(e.target.value)}>
          {(levels.data ?? []).map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
              {l.key === request.classification ? " (requested)" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="First agent" labelHint="Optional" description="Start the team with one draft agent made from a template. Its owner changes it and publishes it when ready.">
        <NativeSelect value={starter} onChange={(e) => setStarter(e.target.value)}>
          <option value="">No first agent</option>
          {(templates.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {needsOwner ? (
        <Field label="Owner" description="The email of the person who will own the team. The person who asked is told, and is not on the team." error={submitted || serverRefusedOwner ? ownerError : undefined}>
          <Input aria-required type="email" autoComplete="off" value={otherOwner} onChange={(e) => (setOtherOwner(e.target.value), approve.reset())} />
        </Field>
      ) : (
        <p>
          Owner: <strong>{asked}</strong>. {request.ownerEmail ? "They were named in the request." : "The person who asked."} Someone who has never signed in is invited by email.
        </p>
      )}
      {!taken && !serverRefusedOwner && <ApiErrorAlert error={approve.error} />}
    </FormDialog>
  );
}

export function DeclineDialog({ request, onClose }: { request: AdminTeamRequest; onClose: () => void }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const decidedElsewhere = useDecidedElsewhere(request, onClose);
  const decline = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/admin/team-requests/{requestId}/decline", { params: { path: { requestId: request.id }, header: ifMatch(request.revision) }, body: { reason: reason.trim() } })),
    onSuccess: () => {
      refresh();
      toast.success(`"${request.name}" was declined`);
      onClose();
    },
    onError: decidedElsewhere,
  });
  const error = !reason.trim() ? "Say why: the person who asked reads this." : undefined;
  return (
    <FormDialog
      title={`Decline "${request.name}"`}
      description="No team is created. The person who asked is told, with your reason."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (!error) decline.mutate();
      }}
      submitLabel="Decline request"
      busy={decline.isPending}
      formProps={{ noValidate: true }}
    >
      <Field label="Reason" description="Up to 500 characters." error={submitted ? error : undefined}>
        <Textarea aria-required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ApiErrorAlert error={decline.error} />
    </FormDialog>
  );
}

export function ViewRequestDialog({ request, onClose }: { request: AdminTeamRequest; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={request.name} description={statusLabels[request.status]} footer={<DialogClose>Close</DialogClose>}>
      <Field label="Status">
        <div>
          <RequestStatusBadge status={request.status} />
        </div>
      </Field>
      <Field label="Asked by">
        <Input readOnly value={`${request.requesterName} (${request.requesterEmail})`} />
      </Field>
      <Field label="Purpose">
        <Textarea readOnly rows={5} value={request.purpose} />
      </Field>
      <Field label="Highest classification" description={request.status === "approved" && standingClassification(request) !== request.classification ? `Asked for ${request.classification}; the reviewer approved ${standingClassification(request)}.` : undefined}>
        <Input readOnly value={standingClassification(request)} />
      </Field>
      <Field label="Owner">
        <Input readOnly value={request.ownerEmail || `${request.requesterEmail} (the requester)`} />
      </Field>
      {request.status === "declined" && (
        <Field label="Reason given">
          <Textarea readOnly rows={3} value={request.decisionReason} />
        </Field>
      )}
      {request.status === "approved" && request.teamSlug && (
        <Field label="Team created">
          <Input readOnly value={`${request.teamName} (/teams/${request.teamSlug})`} />
        </Field>
      )}
      {request.deciderEmail && (
        <Field label="Decided by">
          <Input readOnly value={request.deciderEmail} />
        </Field>
      )}
    </Dialog>
  );
}
