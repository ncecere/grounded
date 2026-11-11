/*
 * "New data source" in two steps (W9): a dialog to choose the type, then a
 * form page (?form=new-upload, ?form=new-web or ?form=new-<connector type>) with
 * Name, Classification and Embedding profile first and the type's own fields
 * below (a website's URLs, mode, limits and the page preview; a connector's
 * settings, credentials and schedule). For a team or the platform.
 *
 *   const create = useCreateSource();
 *   <Button onClick={create.start}>New data source</Button>
 *   {create.element}
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { FormPage, useFormParam } from "@/components/templates/form-page";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { toast } from "@/components/ui/toast/toast";
import { type Classification, type ProfileOption, allowedLevels, rankOf, useClassificationLevels, useEmbeddingProfiles } from "../team/common";
import { useConnectorForm } from "./connector-create";
import { useSourceOwner } from "./owner";
import { type SourceTypeInfo, kindOf, useSourceTypes } from "./types";
import { WebConfigFields } from "./web";
import { WebErrorAlert } from "./host-errors";
import { type WebFormState, formUrls, validateWeb, webDefaults, webInput } from "./web-form";
import c from "./create.module.css";

/** A source type's key: upload, web or a connector's. */
type SourceType = string;

/** Whether a profile's model may process data at the given rank. */
function profileAllows(levels: Classification[] | undefined, p: ProfileOption, rank: number | undefined) {
  const max = rankOf(levels, p.maxClassification);
  return max === undefined || rank === undefined || max >= rank;
}

/** Classification levels the owner may use (a team: up to its approved level). */
export function useOwnerLevels() {
  const owner = useSourceOwner();
  const levels = useClassificationLevels();
  const usable = owner.maxClassification ? allowedLevels(levels.data, owner.maxClassification) : (levels.data ?? []);
  return { levels, usable };
}

const typeOf = (value: string | undefined): SourceType | undefined => (value?.startsWith("new-") && value.length > 4 ? value.slice(4) : undefined);

const builtIn: Record<string, { label: string; description: string }> = {
  upload: { label: "Upload files", description: "PDF, Word, PowerPoint, HTML, Markdown and text files, from your computer or the API." },
  web: { label: "Website", description: "Fetch pages from a website and keep them in sync on a schedule." },
};

/** The types a new source can be: the ones that are on, and for a shared source the ones that can be shared. */
function useCreatableTypes(): SourceTypeInfo[] | undefined {
  const types = useSourceTypes();
  const platform = useSourceOwner().kind === "platform";
  return types.data?.filter((t) => t.enabled && (!platform || t.capabilities.shared));
}

/**
 * The "New data source" flow: `start()` opens the type dialog; `element` renders it and the form page.
 * `hint` is a note shown on the form and never saved (the Gaps page's topic, aud-3).
 */
export function useCreateSource(defaults?: { hint?: string }): { start: () => void; element: ReactNode } {
  const owner = useSourceOwner();
  const form = useFormParam();
  const [picking, setPicking] = useState(false);
  const type = typeOf(form.id);
  return {
    start: () => setPicking(true),
    element: (
      <>
        {picking && (
          <SourceTypeDialog
            onClose={() => setPicking(false)}
            onPick={(t) => {
              setPicking(false);
              form.open(`new-${t}`);
            }}
          />
        )}
        {type && owner.canEdit && (
          <CreateSourcePage
            key={type}
            type={type}
            hint={defaults?.hint}
            onBack={() => {
              form.close();
              setPicking(true);
            }}
            onClose={form.close}
          />
        )}
      </>
    ),
  };
}

/** Step 1: choose the type. */
export function SourceTypeDialog({ onClose, onPick }: { onClose: () => void; onPick: (type: SourceType) => void }) {
  const types = useCreatableTypes();
  const [picked, setChoice] = useState<SourceType>("upload");
  const platform = useSourceOwner().kind === "platform";
  // Until the list loads, the two types every install has; a choice that isn't offered falls back to the first.
  const options = (types ?? [{ key: "upload" }, { key: "web" }]).map((t) => ({
    value: t.key,
    label: builtIn[t.key]?.label ?? ("name" in t ? t.name : t.key),
    description: builtIn[t.key]?.description ?? ("description" in t ? t.description : ""),
  }));
  const choice = options.some((o) => o.value === picked) ? picked : (options[0]?.value ?? "upload");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={platform ? "New shared source" : "New data source"}
      description="What should the source hold? The type can't be changed later."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button disabled={options.length === 0} onClick={() => onPick(choice)}>
            Continue
          </Button>
        </>
      }
    >
      <RadioGroup<SourceType>
        legend="Source type"
        variant="card"
        value={choice}
        onValueChange={setChoice}
        options={options}
      />
      {options.length === 0 && <Alert tone="warning">A platform admin has turned every source type off.</Alert>}
    </Dialog>
  );
}

/** Step 2: the form page. */
type CreateProps = { type: SourceType; hint?: string; onBack?: () => void; onClose: () => void };

export function CreateSourcePage({ type, hint, onBack, onClose }: CreateProps) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const { levels, usable } = useOwnerLevels();
  const profiles = useEmbeddingProfiles();
  const [form, setForm] = useState({ type, name: "", description: "", classification: "", embeddingProfileId: "" });
  const [web, setWeb] = useState<WebFormState>(webDefaults);
  const [submitted, setSubmitted] = useState(false);
  const classification = form.classification || usable[0]?.key || "";
  const embeddingProfileId = form.embeddingProfileId || profiles.data?.find((p) => p.isDefault)?.id || profiles.data?.[0]?.id || "";
  const kind = kindOf(form.type);
  const isWeb = kind === "web";
  const types = useSourceTypes();
  const connectorType = kind === "connector" ? types.data?.find((t) => t.key === form.type) : undefined;
  const connector = useConnectorForm(connectorType, submitted);
  const webErrors = isWeb ? validateWeb(web) : {};
  const nameError = form.name.trim() ? undefined : "Enter a name.";
  const platform = owner.kind === "platform";

  const create = useMutation({
    mutationFn: () =>
      owner.api.create({
        name: form.name.trim(),
        description: form.description,
        type: form.type,
        classification,
        embeddingProfileId: embeddingProfileId || undefined,
        web: isWeb ? webInput(web) : undefined,
        connector: kind === "connector" ? connector.body() : undefined,
      }),
    onSuccess: (src) => {
      qc.invalidateQueries({ queryKey: owner.keys.list });
      for (const key of owner.keys.related) qc.invalidateQueries({ queryKey: key });
      if (src.type === "web") toast.success(platform ? "Shared source created" : "Data source created", "The first crawl has started.");
      else if (kindOf(src.type) === "connector") toast.success("Data source created", "The first sync has started.");
      else toast.success(platform ? "Shared source created" : "Data source created", `${src.name} is ready for uploads.`);
      // Replace the form page's history entry: Back from the new source returns to the list.
      owner.go(navigate, src.id, { replace: true });
    },
  });
  const loading = levels.isLoading || profiles.isLoading || (kind === "connector" && types.isLoading);

  function submit() {
    setSubmitted(true);
    if (nameError || Object.keys(webErrors).length > 0 || (kind === "connector" && !connector.valid)) {
      // Move focus to the first invalid field once the errors have rendered.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    create.mutate();
  }

  const title =
    kind === "connector"
      ? `New ${connectorType?.name ?? form.type} source`
      : isWeb
        ? platform ? "New shared website source" : "New website source"
        : platform ? "New shared upload source" : "New upload source";
  // A type that is off, unknown, or can't be made here (a link from before it was turned off).
  const unavailable = kind === "connector" && !types.isLoading && (!connectorType || !connectorType.enabled || (platform && !connectorType.capabilities.shared));
  return (
    <FormPage
      label={title}
      title={title}
      description={
        platform
          ? "Shared sources are managed by platform admins. Every team can attach them to knowledge bases, within its approved classification."
          : isWeb
            ? "Index pages from a website and keep them in sync."
            : kind === "connector"
              ? (connectorType?.description ?? "Index documents from another system and keep them in sync.")
              : "Upload files from your computer or the API after creating it."
      }
      onClose={onClose}
      onSubmit={submit}
      submitLabel={isWeb ? "Create and start crawl" : kind === "connector" ? "Create and start sync" : platform ? "Create shared source" : "Create data source"}
      busy={create.isPending}
      submitDisabled={!classification || unavailable}
      loading={loading}
      formRef={formRef}
      startActions={
        onBack && (
          <Button variant="ghost" onClick={onBack}>
            Change type
          </Button>
        )
      }
    >
      <ErrorAlert error={levels.error || profiles.error} />
      {hint && <Alert tone="info">{hint}</Alert>}
      {unavailable && (
        <Alert tone="warning" title="This source type isn't available">
          A platform admin turns source types on and off. Choose another type.
        </Alert>
      )}
      <Field label="Name" error={submitted ? nameError : undefined}>
        <Input aria-required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <LevelAndProfileFields
        classification={classification}
        embeddingProfileId={embeddingProfileId}
        onChange={(patch) => setForm({ ...form, ...patch })}
      />
      <Field label="Description" labelHint="Optional">
        <Textarea rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      {isWeb && (
        <fieldset className={c.section}>
          <legend className={c.legend}>Website</legend>
          <WebConfigFields value={web} onChange={setWeb} errors={submitted ? webErrors : {}} />
        </fieldset>
      )}
      {kind === "connector" && connectorType && !unavailable && (
        <fieldset className={c.section}>
          <legend className={c.legend}>{connectorType.name}</legend>
          {connectorType.capabilities.permissions === "provider" && (
            <Alert tone="info">
              Each document is readable by the people and groups {connectorType.name} names, and by nobody else. What can't be matched gives nobody access.
            </Alert>
          )}
          {connector.element}
        </fieldset>
      )}
      {create.error ? <WebErrorAlert error={create.error} urls={isWeb ? formUrls(web) : []} /> : null}
    </FormPage>
  );
}

type LevelAndProfileProps = {
  classification: string;
  embeddingProfileId: string;
  onChange: (patch: { classification?: string; embeddingProfileId?: string }) => void;
};

/** The source's classification and its embedding profile (profiles not approved for the level are disabled). */
function LevelAndProfileFields({ classification, embeddingProfileId, onChange }: LevelAndProfileProps) {
  const owner = useSourceOwner();
  const { levels, usable } = useOwnerLevels();
  const profiles = useEmbeddingProfiles();
  const rank = rankOf(levels.data, classification);
  return (
    <>
      <Field
        label="Classification"
        description={
          owner.maxClassification
            ? `The most sensitive data this source will hold. Your team is approved up to ${levels.data?.find((l) => l.key === owner.maxClassification)?.name ?? owner.maxClassification}.`
            : "The most sensitive data this source will hold. Teams can attach it only if they're approved for this level."
        }
      >
        <NativeSelect required value={classification} onChange={(e) => onChange({ classification: e.target.value })}>
          {usable.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Embedding profile" description="Knowledge bases can only combine sources that use the same profile. A platform admin can move them to another profile later (a profile migration).">
        <NativeSelect required value={embeddingProfileId} onChange={(e) => onChange({ embeddingProfileId: e.target.value })}>
          {(profiles.data ?? []).map((pr) => {
            const ok = profileAllows(levels.data, pr, rank);
            return (
              <option key={pr.id} value={pr.id} disabled={!ok}>
                {pr.name}
                {pr.isDefault && !/\(default\)/i.test(pr.name) ? " (default)" : ""}
                {ok ? "" : ` \u2014 not approved for ${classification} data`}
              </option>
            );
          })}
        </NativeSelect>
      </Field>
    </>
  );
}
