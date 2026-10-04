/*
 * Admin → Parsing & OCR (docs/ocr.md §2, §5, §6; route /admin/parsing):
 * OCR for scanned documents on the settings template. OCR on/off, the
 * backend (only configured ones can be chosen), the vision model or the
 * languages, the per-document cap, a Test button that reads a built-in
 * sample page; then, outside the form, the documents that failed or need
 * OCR by team and source, with Retry these and Notify owners. OCR is off by
 * default.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { useRevisionForm } from "@/components/templates/revision-form";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { backendDescriptions, backendLabels, parsingChanges, parsingForm, parsingInput, parsingProblems, type OcrBackend, type ParsingForm, type ParsingSettings } from "@/lib/parsing";
import { adminOnly } from "@/lib/terms";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { useModels, type Model } from "../models/common";
import { DocumentProblemsSection } from "./document-problems";
import { TestSection } from "./test-section";

export const parsingKey = ["admin", "parsing"];

export function ParsingPage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useQuery({ queryKey: parsingKey, queryFn: async () => unwrap(await api.GET("/v1/admin/parsing")) });
  const models = useModels();
  const vision = (models.data ?? []).filter((m) => m.kind === "vision");
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Parsing & OCR"
        description={`Grounded reads PDF, Word, PowerPoint, HTML, Markdown and text itself. OCR reads what has no text: scanned PDF pages and image uploads. ${
          settings.data?.ocrEnabled ? "It is on for the platform; each source can turn it off." : "It is off until a platform admin turns it on."
        }`}
      />
      <QueryView query={settings} loadingLabel="Loading parsing settings…">
        {settings.data && <ParsingEditor saved={settings.data} visionModels={vision} isAdmin={isAdmin} />}
      </QueryView>
      <DocumentProblemsSection isAdmin={isAdmin} />
    </Stack>
  );
}

function useSave(saved: ParsingSettings, onSaved: (st: ParsingSettings) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: ParsingForm) =>
      unwrap(await api.PUT("/v1/admin/parsing", { params: { header: ifMatch(saved.revision) }, body: parsingInput(form) })),
    onSuccess: (st) => {
      qc.setQueryData(parsingKey, st);
      toast.success("Parsing settings saved");
      onSaved(st);
    },
  });
}

function ParsingEditor({ saved, visionModels, isAdmin }: { saved: ParsingSettings; visionModels: Model[]; isAdmin: boolean }) {
  // Edits survive a change made elsewhere; SettingsPage asks whose to keep (AD-01).
  const [form, setForm, revision] = useRevisionForm(parsingForm(saved), saved.revision);
  const [submitted, setSubmitted] = useState(false);
  const save = useSave(saved, (st) => setForm(parsingForm(st)));
  const problems = parsingProblems(form, saved);
  const shown = submitted ? problems : {};
  const invalid = submitted && Object.keys(problems).length > 0;
  const changes = parsingChanges(saved, form);
  const set = (patch: Partial<ParsingForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <SettingsPage
      revision={revision}
      dirty={changes > 0}
      canEdit={isAdmin}
      readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save settings"
      message={invalid ? `Not saved: ${Object.values(problems)[0]}` : changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      onSave={() => {
        setSubmitted(true);
        if (Object.keys(problems).length === 0) save.mutate(form);
      }}
      onDiscard={() => setForm(parsingForm(saved))}
    >
      <SettingsSection
        title="OCR"
        description="Only pages without a text layer are read with OCR; pages with text never are. Each source can turn it off in its settings."
        actions={<StatusBadge tone={form.ocrEnabled ? "success" : "neutral"}>{form.ocrEnabled ? "On" : "Off"}</StatusBadge>}
      >
        <Switch
          label="Read scanned pages and images with OCR"
          description="Scanned PDF pages are read at upload; PNG, JPEG and TIFF uploads become one-page documents. With OCR off, image uploads are refused."
          checked={form.ocrEnabled}
          disabled={!isAdmin}
          onCheckedChange={(v) => set({ ocrEnabled: v })}
        />
        <BackendFields form={form} set={set} saved={saved} visionModels={visionModels} disabled={!isAdmin} problems={shown} />
      </SettingsSection>
      <SettingsSection title="Limits" description="Keep OCR's cost bounded. The daily limit is a team limit.">
        <DescriptionList
          items={[
            { label: "Pages per document", value: `At most ${saved.maxPagesPerDocument.toLocaleString()}; pages beyond it are skipped with a warning (OCR_MAX_PAGES_PER_DOCUMENT).` },
            { label: "Pages at once", value: `${saved.concurrency.toLocaleString()} per worker (OCR_CONCURRENCY).` },
            {
              label: "Pages per day",
              value: (
                <>
                  The team limit “OCR pages per day” (<TextLink render={<Link to="/admin/limits" search={{ tab: "ingestion" }} />}>Admin → Limits → Ingestion</TextLink>). A document that would pass it waits until the next day.
                </>
              ),
            },
          ]}
        />
      </SettingsSection>
      {/* Auditors can't run the Test (it reads with the platform's backend): it's left out rather than shown disabled. */}
      {isAdmin && <TestSection form={form} disabled={Object.keys(problems).length > 0} />}
    </SettingsPage>
  );
}

type BackendProps = {
  form: ParsingForm;
  set: (p: Partial<ParsingForm>) => void;
  saved: ParsingSettings;
  visionModels: Model[];
  disabled: boolean;
  problems: Partial<Record<keyof ParsingForm, string>>;
};

function BackendFields({ form, set, saved, visionModels, disabled, problems }: BackendProps) {
  const options = saved.backends.map((b) => ({
    value: b.backend,
    label: backendLabels[b.backend],
    description: b.configured ? backendDescriptions[b.backend] : `Not configured: set ${b.configuredBy}.`,
    disabled: !b.configured && b.backend !== form.backend,
  }));
  const selected = visionModels.find((m) => m.id === form.visionModelId);
  return (
    <>
      <RadioGroup<OcrBackend> legend="Backend" variant="card" disabled={disabled} value={form.backend} onValueChange={(v) => set({ backend: v })} options={options} />
      {problems.backend && <Alert tone="danger" title={problems.backend} />}
      {form.backend === "vision" ? (
        <Field label="Vision model" description="Models of kind vision from Admin → Models." error={problems.visionModelId}>
          <NativeSelect disabled={disabled} value={form.visionModelId} onChange={(e) => set({ visionModelId: e.target.value })}>
            <option value="">Choose a model</option>
            {visionModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.upstreamModel}){m.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <Field label="Languages" description="Tesseract language codes joined with +, for example eng or eng+spa. More languages are slower." error={problems.languages}>
          <Input disabled={disabled} value={form.languages} onChange={(e) => set({ languages: e.target.value })} spellCheck={false} />
        </Field>
      )}
      {selected && (
        <p className={s.settingDescription}>
          Sources classified above the model's maximum ({selected.maxClassification}) can't use it: their scanned pages are skipped, and images can't be uploaded to them.
        </p>
      )}
    </>
  );
}
