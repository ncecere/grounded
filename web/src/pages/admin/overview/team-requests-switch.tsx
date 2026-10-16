/*
 * Admin → Settings › Features › Team requests (v0.6.0, E3): the platform switch for in-app team requests, off by default, and the two limits
 * (how many open requests a person may have, and an optional SSO group they must be in). Platform admins change them (If-Match, audited as
 * platform.team_requests), confirming before they turn the feature off; auditors see them read-only, with the reason. Turning it off hides the
 * request page and refuses new requests; the ones already open stay in the queue until they are decided.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Schemas, api, ifMatch, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";

type Settings = Schemas["TeamRequestSettings"];
type Update = Schemas["TeamRequestSettingsUpdate"];

export const teamRequestSettingsQuery = () => ({
  queryKey: ["admin", "team-request-settings"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/team-requests")),
  staleTime: 30_000,
});

/** The team request settings and their save. */
export function useTeamRequestSettings() {
  const qc = useQueryClient();
  const settings = useQuery(teamRequestSettingsQuery());
  const save = useMutation({
    mutationFn: async (next: Update) => unwrap(await api.PUT("/v1/admin/settings/team-requests", { params: { header: ifMatch(settings.data!.revision) }, body: next })),
    onSuccess: (st) => {
      qc.setQueryData(teamRequestSettingsQuery().queryKey, st);
      // The request page and its entry points follow the capability.
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.enabled ? "Team requests are on" : "Team requests are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: teamRequestSettingsQuery().queryKey }),
  });
  return { settings, save };
}

/** What team requests do in their current state, for the Features row. */
export function teamRequestsText(s: Settings) {
  if (!s.enabled) return "Off: people ask a platform admin (or the request link) for a team, and only platform admins create teams. Requests already open stay in the queue.";
  const who = s.allowedGroup ? `People in the SSO group ${s.allowedGroup}` : "Anyone signed in";
  return `${who} can ask for a team, up to ${s.maxOpen} open request${s.maxOpen === 1 ? "" : "s"} each. Platform admins review them under Admin → Teams → Requests.`;
}

const offConsequences =
  "The Request a team page and its links disappear and new requests are refused, including through the API. Requests already open stay in the queue until a platform admin decides them. Only platform admins create teams again, as before.";

const toUpdate = (s: Settings, change: Partial<Update>): Update => ({ enabled: s.enabled, maxOpen: s.maxOpen, allowedGroup: s.allowedGroup, ...change });

/** The switch and the limits: platform admins confirm before turning the feature off; others see them read-only, with the reason. */
export function TeamRequestsSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useTeamRequestSettings>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!settings.data) return null;
  const cur = settings.data;
  return (
    <>
      <Switch
        label="Allow team requests"
        labelPosition="start"
        checked={cur.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(toUpdate(cur, { enabled: true })) : setConfirming(true))}
      />
      {isAdmin && (
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Who may ask…
        </Button>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn team requests off?"
        description={offConsequences}
        confirmLabel="Turn team requests off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(toUpdate(cur, { enabled: false }), { onSuccess: () => setConfirming(false) })}
      />
      {editing && <LimitsDialog current={cur} save={save} onClose={() => setEditing(false)} />}
    </>
  );
}

function LimitsDialog({ current, save, onClose }: { current: Settings; save: ReturnType<typeof useTeamRequestSettings>["save"]; onClose: () => void }) {
  const [maxOpen, setMaxOpen] = useState(String(current.maxOpen));
  const [group, setGroup] = useState(current.allowedGroup);
  const [submitted, setSubmitted] = useState(false);
  const n = Number(maxOpen);
  const maxError = !Number.isInteger(n) || n < 1 || n > 20 ? "Enter a whole number from 1 to 20." : undefined;
  return (
    <FormDialog
      title="Who may ask for a team"
      description="These limits apply while team requests are on."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (!maxError) save.mutate(toUpdate(current, { maxOpen: n, allowedGroup: group.trim() }), { onSuccess: onClose });
      }}
      submitLabel="Save"
      busy={save.isPending}
      formProps={{ noValidate: true }}
    >
      <Field label="Open requests per person" description="How many requests one person may have waiting at a time." error={submitted ? maxError : undefined}>
        <Input type="number" inputMode="numeric" aria-required value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} />
      </Field>
      <Field
        label="SSO group"
        labelHint="Optional"
        description="Only people whose last sign-in carried this group may ask. Leave empty to let anyone signed in ask. Group names ignore case."
      >
        <Input autoComplete="off" spellCheck={false} value={group} onChange={(e) => setGroup(e.target.value)} />
      </Field>
      <ApiErrorAlert error={save.error} />
    </FormDialog>
  );
}
