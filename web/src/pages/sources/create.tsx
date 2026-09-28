/*
 * "New data source" in two steps (W9): a dialog to choose the type, then a
 * sheet with Name, Classification and Embedding profile first (above the
 * fold) and the type's own fields below (a website's URLs, mode, limits and
 * the page preview). For a team or the platform.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { GuardedSheet, useEditTracker } from "@/components/templates/close-guard";
import { SheetClose } from "@/components/ui/sheet/sheet";
import { Field, Form } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Loading } from "@/components/ui/spinner/spinner";
import { toast } from "@/components/ui/toast/toast";
import { type Classification, type ProfileOption, allowedLevels, rankOf, useClassificationLevels, useEmbeddingProfiles } from "../team/common";
import { useSourceOwner } from "./owner";
import { WebConfigFields } from "./web";
import { WebErrorAlert } from "./host-errors";
import { type WebFormState, formUrls, validateWeb, webDefaults, webInput } from "./web-form";
import c from "./create.module.css";

type SourceType = "upload" | "web";

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

/** Step 1 (choose the type), then step 2 (the form in a sheet). `initialType` skips step 1. */
export function CreateSourceDialog({ onClose, initialType }: { onClose: () => void; initialType?: SourceType }) {
  const [type, setType] = useState<SourceType | undefined>(initialType);
  const [choice, setChoice] = useState<SourceType>("upload");
  const platform = useSourceOwner().kind === "platform";
  if (type) return <CreateSourceSheet type={type} onBack={initialType ? undefined : () => setType(undefined)} onClose={onClose} />;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={platform ? "New shared source" : "New data source"}
      description="What should the source hold? The type can't be changed later."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button onClick={() => setType(choice)}>Continue</Button>
        </>
      }
    >
      <RadioGroup<SourceType>
        legend="Source type"
        variant="card"
        value={choice}
        onValueChange={setChoice}
        options={[
          { value: "upload", label: "Upload files", description: "PDF, Word, PowerPoint, HTML, Markdown and text files, from your computer or the API." },
          { value: "web", label: "Website", description: "Fetch pages from a website and keep them in sync on a schedule." },
        ]}
      />
    </Dialog>
  );
}

function CreateSourceSheet({ type, onBack, onClose }: { type: SourceType; onBack?: () => void; onClose: () => void }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const { levels, usable } = useOwnerLevels();
  const profiles = useEmbeddingProfiles();
  const [form, setForm] = useState({ type, name: "", description: "", classification: "", embeddingProfileId: "" });
  const [web, setWeb] = useState<WebFormState>(webDefaults);
  const [submitted, setSubmitted] = useState(false);
  const edits = useEditTracker();
  const classification = form.classification || usable[0]?.key || "";
  const embeddingProfileId = form.embeddingProfileId || profiles.data?.find((p) => p.isDefault)?.id || profiles.data?.[0]?.id || "";
  const isWeb = form.type === "web";
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
      }),
    onSuccess: (src) => {
      qc.invalidateQueries({ queryKey: owner.keys.list });
      for (const key of owner.keys.related) qc.invalidateQueries({ queryKey: key });
      if (src.type === "web") toast.success(platform ? "Shared source created" : "Data source created", "The first crawl has started.");
      else toast.success(platform ? "Shared source created" : "Data source created", `${src.name} is ready for uploads.`);
      onClose();
      owner.go(navigate, src.id);
    },
  });
  const loading = levels.isLoading || profiles.isLoading;

  function submit() {
    setSubmitted(true);
    if (nameError || Object.keys(webErrors).length > 0) {
      // Move focus to the first invalid field once the errors have rendered.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    create.mutate();
  }

  return (
    <GuardedSheet
      dirty={edits.edited && !create.isPending}
      onClose={onClose}
      size="lg"
      title={isWeb ? (platform ? "New shared website source" : "New website source") : platform ? "New shared upload source" : "New upload source"}
      description={
        platform
          ? "Shared sources are managed by platform admins. Every team can attach them to knowledge bases, within its approved classification."
          : isWeb
            ? "Index pages from a website and keep them in sync."
            : "Upload files from your computer or the API after creating it."
      }
      footer={
        <>
          {onBack && (
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <SheetClose>Cancel</SheetClose>
          <Button type="submit" form={formId} loading={create.isPending} disabled={loading || !classification}>
            {isWeb ? "Create and start crawl" : platform ? "Create shared source" : "Create data source"}
          </Button>
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <Form
          {...edits.formProps}
          id={formId}
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <ErrorAlert error={levels.error || profiles.error} />
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
          {create.error ? <WebErrorAlert error={create.error} urls={isWeb ? formUrls(web) : []} /> : null}
        </Form>
      )}
    </GuardedSheet>
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
      <Field label="Embedding profile" description="The profile can't be changed later. Knowledge bases can only combine sources that use the same profile.">
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
