/*
 * A source's Settings tab on the SettingsPage template (D3, W3): General ·
 * Crawling (web) · Classification · OCR · Danger zone, one form with ONE sticky
 * save bar (F-17 guard included). While a field is invalid the bar says
 * "Not saved: fix the highlighted field" (F-26).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DangerAction, DangerZone, SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { type Classification, plural, rankOf } from "../team/common";
import { type SourceActions, pauseHelp } from "./actions";
import { useOwnerLevels } from "./create";
import { WebErrorAlert } from "./host-errors";
import { ClassificationImpactDialog, ImpactError, impactOf, impactSummary, isLowering } from "./impact";
import { useInvalidateSource } from "./invalidate";
import { type ClassificationImpact, type DataSource, useSourceOwner } from "./owner";
import { WebConfigFields } from "./web";
import { type WebFormState, formUrls, validateWeb, webFormFromConfig, webInput } from "./web-form";

type Form = { name: string; description: string; classification: string; reason: string; web: WebFormState | null; ocrEnabled: boolean };

const formOf = (src: DataSource): Form => ({
  name: src.name,
  description: src.description,
  classification: src.classification,
  reason: "",
  web: src.web ? webFormFromConfig(src.web) : null,
  ocrEnabled: src.ocrEnabled,
});

const webChanged = (a: WebFormState | null, b: WebFormState | null) => Boolean(a && b) && JSON.stringify(webInput(a!)) !== JSON.stringify(webInput(b!));

export function SourceSettings({ source, levels, actions }: { source: DataSource; levels: Classification[]; actions: SourceActions }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const { usable } = useOwnerLevels();
  const initial = formOf(source);
  const [form, setForm] = useState<Form>(initial);
  const [impact, setImpact] = useState<ClassificationImpact | null>(null);
  const invalidate = useInvalidateSource(source);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const currentRank = rankOf(levels, source.classification) ?? 0;
  // Editors may only raise a classification; admins and owners may also lower it.
  const options = usable.filter((l) => owner.canLower || l.rank >= currentRank);
  const lowering = isLowering(levels, source.classification, form.classification);
  const raising = !lowering && form.classification !== source.classification;
  const errors = {
    name: form.name.trim() ? undefined : "Enter a name.",
    reason: lowering && form.reason.trim().length < 10 ? "Enter at least 10 characters." : undefined,
    web: form.web ? validateWeb(form.web) : {},
  };
  const invalid = Boolean(errors.name || errors.reason || Object.keys(errors.web).length > 0);
  const dirty =
    form.name.trim() !== source.name ||
    form.description !== source.description ||
    form.classification !== source.classification ||
    form.ocrEnabled !== source.ocrEnabled ||
    webChanged(form.web, initial.web);

  const save = useMutation({
    mutationFn: async () => {
      const body: Parameters<typeof owner.api.update>[1] = {};
      if (form.name.trim() !== source.name) body.name = form.name.trim();
      if (form.description !== source.description) body.description = form.description;
      if (form.classification !== source.classification) {
        body.classification = form.classification;
        if (lowering) body.reason = form.reason.trim();
        // Shared sources: check the change against every team's knowledge bases first.
        if (owner.api.previewClassification) {
          const preview = await owner.api.previewClassification(source, form.classification);
          if (preview.affected.length > 0 || (preview.agents?.length ?? 0) > 0) throw new ImpactError(preview);
        }
      }
      if (form.web && webChanged(form.web, initial.web)) body.web = webInput(form.web);
      if (form.ocrEnabled !== source.ocrEnabled) body.ocrEnabled = form.ocrEnabled;
      return owner.api.update(source, body);
    },
    onSuccess: (updated) => {
      qc.setQueryData(owner.keys.source(source.id), updated);
      setForm(formOf(updated));
      toast.success("Settings saved", source.type === "web" ? "Crawl changes apply from the next sync." : undefined);
    },
    onError: (err) => setImpact(impactOf(err)),
    onSettled: invalidate,
  });
  const blocked = impactOf(save.error);
  const web = source.type === "web";

  return (
    <>
      <SettingsPage
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setForm(initial);
          save.reset();
        }}
        saveLabel="Save settings"
        message={invalid ? "Not saved: fix the highlighted field" : undefined}
        saveDisabled={invalid}
      >
        <SettingsSection title="General" description="How the source is named in lists and knowledge bases.">
          <Field label="Name" error={errors.name}>
            <Input aria-required maxLength={100} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Description" labelHint="Optional">
            <Textarea maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </SettingsSection>
        {web && form.web && (
          <SettingsSection title="Crawling" description="What to fetch and how often. Changes apply from the next sync.">
            <WebConfigFields value={form.web} onChange={(next) => set({ web: next })} errors={errors.web} />
          </SettingsSection>
        )}
        <SettingsSection title="Classification" description="The most sensitive data this source holds. Knowledge bases take the level of their most sensitive source.">
          <Field
            label="Classification"
            description={owner.canLower ? "Lowering it needs a reason, which is recorded in the audit log." : "Editors can raise the classification. Only team admins and owners can lower it."}
          >
            <NativeSelect value={form.classification} onChange={(e) => set({ classification: e.target.value })}>
              {options.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {raising && (
            <Alert tone="info" title="Raising the classification">
              {owner.kind === "platform"
                ? "It's blocked while knowledge bases of teams approved below the new level use this source, or while a published agent that uses it has a chat model or audience that isn't allowed for the level."
                : "It's blocked while a published agent that uses this source has a chat model or audience that isn't allowed for the new level. Saving checks this and names the agents."}
            </Alert>
          )}
          {lowering && (
            <Field
              label="Reason for lowering the classification"
              error={form.reason ? errors.reason : undefined}
              description={
                owner.kind === "platform"
                  ? "At least 10 characters. The reason is recorded in the audit log."
                  : "At least 10 characters. The reason is recorded in the audit log and sent to team owners."
              }
            >
              <Textarea aria-required minLength={10} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
            </Field>
          )}
        </SettingsSection>
        <SettingsSection
          title="OCR"
          description={
            source.ocrState === "platform_off"
              ? "Scanned pages (without a text layer) and image uploads are read with OCR when the platform has it on. It is off for the platform now: a platform admin can turn it on."
              : "Scanned pages (without a text layer) and image uploads are read with OCR when the platform has it on."
          }
        >
          <Switch
            label="Read scanned pages with OCR"
            description={
              form.ocrEnabled
                ? "Turn it off where scanned pages are noise: they are skipped, and images can't be uploaded. Documents already processed keep their text."
                : "Scanned pages are skipped and images can't be uploaded. After turning it on, retry the documents skipped as scanned (Documents tab, Needs OCR). A document indexed with only some pages skipped isn't retried: delete it and upload it again."
            }
            checked={form.ocrEnabled}
            onCheckedChange={(v) => set({ ocrEnabled: v })}
          />
        </SettingsSection>
        {blocked ? (
          <Alert
            tone="warning"
            title="The settings weren't saved"
            actions={
              <Button size="sm" variant="secondary" onClick={() => setImpact(blocked)}>
                Show what blocks it
              </Button>
            }
          >
            {impactSummary(blocked)} would break at the new classification.
          </Alert>
        ) : save.error ? (
          <WebErrorAlert error={save.error} urls={form.web ? formUrls(form.web) : []} />
        ) : null}
        <DangerZone>
          <DangerAction
            title={actions.paused ? "Resume this source" : "Pause this source"}
            description={actions.paused ? "The source is paused. Resume it to accept uploads and crawl on its schedule again." : pauseHelp(web)}
            action={
              <Button variant="secondary" loading={actions.status.isPending} onClick={actions.toggle}>
                {actions.paused ? "Resume source" : "Pause source"}
              </Button>
            }
          />
          <DangerAction
            title="Delete this source"
            description={`Deletes ${plural(source.documents.total, web ? "page" : "document")} and ${source.documents.total === 1 ? "its" : "their"} passages. ${
              owner.kind === "platform" ? "Every team's knowledge bases must detach it first." : "Remove it from knowledge bases first."
            }`}
            action={
              <Button variant="danger" onClick={actions.requestDelete}>
                Delete source
              </Button>
            }
          />
        </DangerZone>
      </SettingsPage>
      {impact && <ClassificationImpactDialog impact={impact} levels={levels} teamLinks={owner.kind === "team"} onClose={() => setImpact(null)} />}
    </>
  );
}
