/*
 * Add or change a group mapping rule (a short form, so a dialog). The dry run
 * under the fields shows who saving would change; saving applies it at once.
 * A rule's team never changes: map the group to another team with a new rule.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { roleLabels, teamRoles, type TeamRole } from "@/components/roles";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { useDebounced } from "../hooks";
import { RulePreview } from "./preview";
import { groupMappingStatusQuery, groupRulesQuery, groupRulesRoot, type GroupRule, type PreviewRequest } from "./queries";

/** Active teams matching the typed text, for a new rule's team. */
function useTeamOptions(text: string): ComboboxOption[] {
  const q = useDebounced(text.trim(), 250);
  const teams = useQuery({
    queryKey: ["admin", "teams", "rule-picker", q],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/admin/teams", {
          params: { query: { q: q || undefined, status: "active", limit: 20 } },
        }),
      ),
  });
  return (teams.data?.items ?? []).map((t) => ({
    value: t.team.slug,
    label: t.team.name,
    hint: t.team.slug,
  }));
}

type Props = {
  /** The rule to change; absent for a new rule. */
  rule?: GroupRule;
  /** A new rule's team, when it is fixed (a team's Group mapping tab). */
  team?: { slug: string; name: string };
  onClose: () => void;
};

export function RuleDialog({ rule, team: fixedTeam, onClose }: Props) {
  const qc = useQueryClient();
  const listId = useId();
  const [group, setGroup] = useState(rule?.group ?? "");
  const [role, setRole] = useState<TeamRole>(rule?.role ?? "member");
  const [team, setTeam] = useState<string | null>(rule?.team.slug ?? fixedTeam?.slug ?? null);
  const [teamText, setTeamText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const teamOptions = useTeamOptions(teamText);
  const seen = useQuery(groupMappingStatusQuery());
  const teamRules = useQuery({ ...groupRulesQuery(team ?? ""), enabled: Boolean(team) });
  const trimmed = group.trim();
  // Group names match case-insensitively, so a team has one rule per group: say so under the group, once.
  const duplicate = (teamRules.data ?? []).some((r) => r.id !== rule?.id && r.group.toLowerCase() === trimmed.toLowerCase());
  const groupError = !trimmed
    ? "Enter the group's name as the identity provider sends it."
    : trimmed.length > 256
      ? "At most 256 characters."
      : duplicate
        ? "This team already has a rule for that group. Change that rule instead."
        : undefined;
  const teamError = team ? undefined : "Choose a team.";
  const ready = !groupError && !teamError;

  const save = useMutation({
    mutationFn: async () =>
      rule
        ? unwrap(
            await api.PATCH("/v1/admin/group-mapping/rules/{ruleId}", {
              params: {
                path: { ruleId: rule.id },
                header: ifMatch(rule.revision),
              },
              body: { group: trimmed, role },
            }),
          )
        : unwrap(
            await api.POST("/v1/admin/group-mapping/rules", {
              body: { group: trimmed, team: team!, role },
            }),
          ),
    onSuccess: (r) => {
      toast.success(rule ? "Rule saved" : "Rule added", `${r.group} → ${r.team.name}, ${roleLabels[r.role].toLowerCase()}`);
      onClose();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: groupRulesRoot });
      void qc.invalidateQueries({ queryKey: ["admin", "team"] });
    },
  });

  const previewBody: PreviewRequest = rule ? { ruleId: rule.id, group: trimmed, role, delete: false } : { group: trimmed, team: team ?? "", role, delete: false };
  const teamItems: ComboboxOption[] = team && !teamOptions.some((o) => o.value === team) ? [{ value: team, label: fixedTeam?.name ?? team }, ...teamOptions] : teamOptions;

  return (
    <FormDialog
      title={rule ? "Change group mapping rule" : "Add group mapping rule"}
      description="People in the identity-provider group get this role in the team when they sign in. Members added by hand are never changed."
      size="lg"
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (ready) save.mutate();
      }}
      submitLabel={rule ? "Save rule" : "Add rule"}
      busy={save.isPending}
      formProps={{ noValidate: true }}
    >
      <Field label="IdP group" description="Matching ignores upper and lower case." error={submitted || duplicate ? groupError : undefined}>
        <Input aria-required autoComplete="off" spellCheck={false} list={listId} placeholder="registrar-staff" value={group} onChange={(e) => setGroup(e.target.value)} />
      </Field>
      <datalist id={listId}>
        {(seen.data?.groups ?? []).map((g) => (
          <option key={g.name} value={g.name} />
        ))}
      </datalist>
      {rule || fixedTeam ? (
        <Field label="Team" description={rule ? "A rule's team can't change. Add a rule to map the group to another team." : undefined}>
          <Input value={rule?.team.name ?? fixedTeam?.name ?? ""} readOnly />
        </Field>
      ) : (
        <Field label="Team" error={submitted ? teamError : undefined}>
          <Combobox
            items={teamItems}
            value={team}
            onValueChange={(v) => setTeam(v)}
            onInputValueChange={setTeamText}
            placeholder="Search teams"
            emptyText="No active team matches."
            autoHighlight
          />
        </Field>
      )}
      <Field label="Role">
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
          {teamRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <RulePreview body={previewBody} enabled={ready} />
      {/* A duplicate the list didn't know about yet (added elsewhere meanwhile) is refused by the server: said here. */}
      <ErrorAlert error={save.error} />
    </FormDialog>
  );
}
