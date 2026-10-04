/* Admin team › Settings (A4): name, description and approved classification in one form, and Archive in the Danger zone. */
import { adminOnly } from "@/lib/terms";
import type { Schemas } from "@/api/client";
import { DangerAction, DangerZone, SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { useRevisionForm } from "@/components/templates/revision-form";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { useClassificationLevels } from "../../team/common";
import type { useTeamUpdate } from "./team";

type Form = { name: string; description: string; maxClassification: string };
const formOf = (t: Schemas["Team"]): Form => ({ name: t.name, description: t.description, maxClassification: t.maxClassification });
const labels = { name: "Name", description: "Description", maxClassification: "Approved classification" };

type Props = { team: Schemas["Team"]; isAdmin: boolean; onArchive: () => void; status: ReturnType<typeof useTeamUpdate> };

export function TeamSettingsTab({ team, isAdmin, onArchive, status }: Props) {
  const levels = useClassificationLevels();
  const saved = formOf(team);
  // Edits survive a change made elsewhere (another tab or admin): SettingsPage asks whose to keep (AD-01).
  const choices = { maxClassification: Object.fromEntries((levels.data ?? []).map((l) => [l.key, l.name])) };
  const [form, setForm, revision] = useRevisionForm(saved, team.revision, { labels, choices });
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== saved[k]);
  const nameError = form.name.trim() === "" ? "Enter a name." : undefined;
  const lowered = (levels.data?.find((l) => l.key === form.maxClassification)?.rank ?? 0) < (levels.data?.find((l) => l.key === saved.maxClassification)?.rank ?? 0);
  const archived = team.status === "archived";
  return (
    <SettingsPage
      revision={revision}
      dirty={dirty}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={status.isPending}
      error={status.error}
      saveLabel="Save settings"
      onSave={() => status.mutate({ ...form, name: form.name.trim() })}
      onDiscard={() => setForm(saved)}
      saveDisabled={Boolean(nameError)}
      message={nameError ? "Not saved: fix the highlighted field" : undefined}
    >
      <SettingsSection title="General">
        <Field label="Name" error={nameError}>
          <Input required disabled={!isAdmin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description" labelHint="Optional">
          <Textarea disabled={!isAdmin} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label="Approved classification"
          description={
            lowered
              ? "Lowering it is refused while the team has data sources (or attached shared sources) above the new level."
              : "The most sensitive data this team may upload. Raising it lets the team use more sensitive sources."
          }
        >
          <NativeSelect disabled={!isAdmin} value={form.maxClassification} onChange={(e) => setForm({ ...form, maxClassification: e.target.value })}>
            {levels.data?.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </SettingsSection>
      {isAdmin && (
        <DangerZone>
          {archived ? (
            <DangerAction
              title="Unarchive this team"
              description="Members can change the team's sources, knowledge bases and agents again."
              action={
                <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: "active" })}>
                  Unarchive team
                </Button>
              }
            />
          ) : (
            <DangerAction
              title="Archive this team"
              description="The team becomes read-only for its members. You can unarchive it later."
              action={
                <Button variant="danger" onClick={onArchive}>
                  Archive team
                </Button>
              }
            />
          )}
        </DangerZone>
      )}
    </SettingsPage>
  );
}
