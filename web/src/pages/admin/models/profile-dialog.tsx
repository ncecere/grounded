/* Creating an embedding profile, and editing a profile's default fusion weights. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { fieldError } from "@/lib/field-errors";
import { slugKey } from "./model-dialog";
import { Button } from "@/components/ui/button/button";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field, Form } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { useFormState } from "@/lib/use-form-state";
import { useLevelName } from "../../team/common";
import type { FusionForm } from "../../team/kbs/fusion-form";
import s from "../../shared.module.css";
import { type Model, type Profile, useModels } from "./common";
import {
  initialProfileForm,
  missingPrefixes,
  prefillPrefixes,
  type PrefixHint,
  profileBody,
  profileErrors,
  profileFusionForm,
  profileFusionPatch,
  type ProfileForm,
  recommendedPrefixes,
} from "./profile-form";

type SetField = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => void;
type Errors = ReturnType<typeof profileErrors>;

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const models = useModels();
  const embedding = (models.data ?? []).filter((x) => x.kind === "embedding" && x.enabled);
  const [form, set, setForm] = useFormState(initialProfileForm);
  const [submitted, setSubmitted] = useState(false);
  const modelId = form.modelId || embedding[0]?.id || "";
  const selected = embedding.find((x) => x.id === modelId);
  // A model with known prefixes (nomic, Qwen3-Embedding) fills them in; ones typed by hand stay (G7).
  const hint = recommendedPrefixes(selected);
  const lastHint = useRef<PrefixHint | undefined>(undefined);
  useEffect(() => {
    const prev = lastHint.current;
    lastHint.current = hint;
    if (prev !== hint) setForm((f) => prefillPrefixes(f, prev, hint));
  }, [hint, setForm]);
  const errors = profileErrors(form, selected?.dimensions ?? undefined);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/embedding-profiles", { body: profileBody(form, modelId) })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "profiles"] });
      toast.success("Embedding profile created");
      onClose();
    },
  });
  // Not a FormDialog: there is no form (and no submit button) until an embedding model exists.
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add embedding profile"
      description="Everything except the name, description, status and fusion defaults is fixed once created."
      size="lg"
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          {embedding.length > 0 && (
            <Button type="submit" form={formId} loading={save.isPending}>
              Create profile
            </Button>
          )}
        </>
      }
    >
      {models.isLoading ? (
        <Loading />
      ) : embedding.length === 0 ? (
        <EmptyState size="compact" icon={<Cpu />} title="Add and enable an embedding model first." />
      ) : (
        <Form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (Object.keys(errors).length === 0) save.mutate();
          }}
        >
          <ProfileFields form={form} set={set} setForm={setForm} embedding={embedding} selected={selected} errors={submitted ? errors : {}} serverError={save.error} />
          <PrefixWarning form={form} hint={hint} onUse={() => setForm((f) => ({ ...f, documentPrefix: hint!.documentPrefix, queryPrefix: hint!.queryPrefix }))} />
          <FusionDefaultsFields value={form.fusion} onChange={(f) => set("fusion", f)} errors={submitted ? errors : {}} />
          <Checkbox label="Make this the default profile" checked={form.isDefault} onCheckedChange={(v) => set("isDefault", v)} />
          {!fieldError(save.error, ["invalid_chunk_size", "invalid_chunk_overlap"]) && <ErrorAlert error={save.error} />}
        </Form>
      )}
    </Dialog>
  );
}

type FieldsProps = {
  form: ProfileForm;
  set: SetField;
  setForm: (f: (cur: ProfileForm) => ProfileForm) => void;
  embedding: Model[];
  selected?: Model;
  errors: Errors;
  serverError?: unknown;
};

function ProfileFields({ form, set, setForm, embedding, selected, errors, serverError }: FieldsProps) {
  const levelName = useLevelName();
  // The key follows the name until it's typed (AD-27), as a team's slug does.
  const [keyTyped, setKeyTyped] = useState(false);
  return (
    <div className={s.grid2}>
      <Field label="Name">
        <Input
          required
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((f) => ({ ...f, name, ...(keyTyped ? {} : { key: slugKey(name) }) }));
          }}
        />
      </Field>
      <Field label="Key" description="Filled in from the name. Can't be changed later.">
        <Input required pattern="[a-z0-9][a-z0-9._\-]{0,62}" value={form.key} onChange={(e) => (setKeyTyped(true), set("key", e.target.value))} />
      </Field>
      <Field label="Embedding model" description={selected ? `${selected.dimensions != null ? `${selected.dimensions.toLocaleString()} dimensions; allowed` : "Allowed"} up to ${levelName(selected.maxClassification)}` : undefined}>
        <NativeSelect value={selected?.id ?? ""} onChange={(e) => set("modelId", e.target.value)}>
          {embedding.map((x) => (
            <option key={x.id} value={x.id}>
              {x.displayName}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Vector storage" description="halfvec halves storage and supports up to 4000 dimensions.">
        <NativeSelect value={form.storageType} onChange={(e) => set("storageType", e.target.value as "halfvec" | "vector")}>
          <option value="halfvec">halfvec (recommended)</option>
          <option value="vector">vector</option>
        </NativeSelect>
      </Field>
      <Field
        label="Output dimensions"
        labelHint="Optional"
        description={`Store fewer dimensions than the model's ${selected?.dimensions ?? ""} (Matryoshka models only, e.g. 768 for Qwen3-Embedding). Empty keeps them all.`}
        error={errors.outputDimensions}
      >
        <NumberInput maximumFractionDigits={0} value={form.outputDimensions} onValueChange={(v) => set("outputDimensions", v)} />
      </Field>
      <Field label="Document prefix" description='Some models need one, e.g. "search_document: " for nomic. Filled in for models with known prefixes.'>
        <Input value={form.documentPrefix} onChange={(e) => set("documentPrefix", e.target.value)} />
      </Field>
      <Field label="Query prefix" description='e.g. "search_query: " for nomic, or "Instruct: <task>\nQuery: " for Qwen3-Embedding. Filled in for models with known prefixes.'>
        <Textarea rows={2} value={form.queryPrefix} onChange={(e) => set("queryPrefix", e.target.value)} />
      </Field>
      <Field label="Passage size (tokens)" error={fieldError(serverError, ["invalid_chunk_size"])}>
        <NumberInput maximumFractionDigits={0} value={String(form.chunkSize)} onValueChange={(v) => set("chunkSize", Number(v))} />
      </Field>
      <Field label="Passage overlap (tokens)" error={fieldError(serverError, ["invalid_chunk_overlap"])}>
        <NumberInput maximumFractionDigits={0} value={String(form.chunkOverlap)} onValueChange={(v) => set("chunkOverlap", Number(v))} />
      </Field>
      <Field label="Description" labelHint="Optional" className={s.span2}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
    </div>
  );
}

/** Recommended prefixes left empty: retrieval with this model gets worse without them. */
function PrefixWarning({ form, hint, onUse }: { form: ProfileForm; hint?: PrefixHint; onUse: () => void }) {
  const missing = missingPrefixes(form, hint);
  if (!hint || missing.length === 0) return null;
  const show = (v: string) => JSON.stringify(v);
  return (
    <Alert tone="warning" title={`${hint.family} expects ${missing.length === 2 ? "prefixes" : `a ${missing[0]} prefix`}`}>
      <p>
        {[hint.documentPrefix && `Documents: ${show(hint.documentPrefix)}`, hint.queryPrefix && `Queries: ${show(hint.queryPrefix)}`].filter(Boolean).join(". ")}. Without
        them, search results are usually worse. Leave them empty only if your gateway adds them.
      </p>
      <Button size="sm" variant="secondary" onClick={onUse}>
        Use the recommended prefixes
      </Button>
    </Alert>
  );
}

type FusionProps = { value: FusionForm; onChange: (f: FusionForm) => void; errors: Errors };

/** The profile's default fusion weights: the platform default, or its own. */
function FusionDefaultsFields({ value, onChange, errors }: FusionProps) {
  return (
    <>
      <Switch
        label="Knowledge bases use the platform fusion weights"
        description="Turn off to set this profile's own default. A knowledge base's own weights still win. Strong embedders often do best with a small keyword weight (0–0.02)."
        checked={value.useDefault}
        onCheckedChange={(useDefault) => onChange({ ...value, useDefault })}
      />
      {!value.useDefault && (
        <div className={s.grid2}>
          <Field label="Default vector weight" description="From 0 to 1." error={errors.vector}>
            <Input inputMode="decimal" autoComplete="off" value={value.vector} onChange={(e) => onChange({ ...value, vector: e.target.value })} />
          </Field>
          <Field label="Default keyword weight" description="From 0 to 1." error={errors.keyword}>
            <Input inputMode="decimal" autoComplete="off" value={value.keyword} onChange={(e) => onChange({ ...value, keyword: e.target.value })} />
          </Field>
        </div>
      )}
      {errors.fusion && <Alert tone="danger">{errors.fusion}</Alert>}
    </>
  );
}

/** Edit an existing profile's default fusion weights (mutable, unlike its vector settings). */
export function ProfileFusionDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const qc = useQueryClient();
  const [fusion, setFusion] = useState(() => profileFusionForm(profile));
  const [submitted, setSubmitted] = useState(false);
  const errors = profileErrors({ ...initialProfileForm, fusion }, undefined);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/v1/admin/embedding-profiles/{profileId}", {
          params: { path: { profileId: profile.id }, header: ifMatch(profile.revision) },
          body: profileFusionPatch(fusion),
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "profiles"] });
      toast.success(`Fusion defaults of ${profile.name} saved`);
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Fusion defaults of ${profile.name}`}
      description="Knowledge bases on this profile that don't set their own weights use these."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(errors).length === 0) save.mutate();
      }}
      submitLabel="Save"
      busy={save.isPending}
    >
      <FusionDefaultsFields value={fusion} onChange={setFusion} errors={submitted ? errors : {}} />
      <ErrorAlert error={save.error} />
    </FormDialog>
  );
}
