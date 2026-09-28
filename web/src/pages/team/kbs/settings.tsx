/*
 * A knowledge base's Settings tab on the SettingsPage template (D3, W4):
 * General · Retrieval (passages per search and the fusion weights, as
 * sliders) · Danger zone, with one sticky save bar. While a field is invalid
 * nothing claims to be saved: the bar says "Not saved: fix the highlighted
 * field" (F-26).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { DangerAction, DangerZone, SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Slider } from "@/components/ui/slider/slider";
import { toast } from "@/components/ui/toast/toast";
import { type KB, kbKey, kbsKey, useTeam } from "../common";
import { FusionSettings } from "./fusion";
import { fusionErrors, fusionFormOf, fusionPatch } from "./fusion-form";

const formOf = (kb: KB) => ({ name: kb.name, description: kb.description, topK: kb.topK, fusion: fusionFormOf(kb) });
type Form = ReturnType<typeof formOf>;

export function KBSettings({ kb, onDelete }: { kb: KB; onDelete: () => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(kb));
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const nameError = form.name.trim() ? undefined : "Enter a name.";
  const fusionInvalid = Object.keys(fusionErrors(form.fusion)).length > 0;
  const invalid = Boolean(nameError) || fusionInvalid;
  const fusionBody = fusionInvalid ? {} : fusionPatch(form.fusion, kb);
  const dirty =
    form.name.trim() !== kb.name ||
    form.description !== kb.description ||
    form.topK !== kb.topK ||
    fusionInvalid ||
    Object.keys(fusionBody).length > 0 ||
    form.fusion.useDefault !== !kb.fusionWeights;

  const update = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/v1/teams/{team}/kbs/{kbId}", {
          params: { path: { team: slug, kbId: kb.id }, header: ifMatch(kb.revision) },
          body: { name: form.name.trim(), description: form.description, topK: form.topK, ...fusionPatch(form.fusion, kb) },
        }),
      ),
    onSuccess: (updated) => {
      qc.setQueryData(kbKey(slug, kb.id), updated);
      qc.invalidateQueries({ queryKey: kbsKey(slug) });
      setForm(formOf(updated));
      toast.success("Settings saved");
    },
  });

  return (
    <SettingsPage
      dirty={dirty}
      saving={update.isPending}
      error={update.error}
      onSave={() => update.mutate()}
      onDiscard={() => {
        setForm(formOf(kb));
        update.reset();
      }}
      saveLabel="Save settings"
      message={invalid ? "Not saved: fix the highlighted field" : undefined}
      saveDisabled={invalid}
    >
      <SettingsSection title="General">
        <Field label="Name" error={nameError}>
          <Input aria-required maxLength={100} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Description" labelHint="Optional">
          <Textarea maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Retrieval" description="How searches of this knowledge base rank and return passages. Agents searching it use the same settings.">
        <Slider
          label="Passages per search"
          min={1}
          max={50}
          value={form.topK}
          onValueChange={(v) => set({ topK: Array.isArray(v) ? v[0]! : (v as number) })}
          showValue
          getAriaValueText={(t) => `${t} passages`}
        />
        <FusionSettings kb={kb} value={form.fusion} onChange={(fusion) => set({ fusion })} />
      </SettingsSection>
      <DangerZone>
        <DangerAction
          title="Delete this knowledge base"
          description="Its data sources and documents are kept. Published agents that use it must drop it first."
          action={
            <Button variant="danger" onClick={onDelete}>
              Delete knowledge base
            </Button>
          }
        />
      </DangerZone>
    </SettingsPage>
  );
}
