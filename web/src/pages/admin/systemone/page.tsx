/*
 * Admin → SystemOne (ADR-0020, docs/systemone.md §2, A10): on the settings
 * template, the model at the top and one section per feature with its
 * switch, state, recent latency and tunables (shown when on). Everything is
 * off by default; the page is only usable once a SystemOne model exists.
 */
import { adminOnly } from "@/lib/terms";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { useRevisionForm } from "@/components/templates/revision-form";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { toast } from "@/components/ui/toast/toast";
import { modeLabels, settingsChanges, settingsForm, settingsInput, settingsProblems, type SettingsForm, type SystemOneSettings } from "@/lib/systemone";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { useModels, type Model } from "../models/common";
import { CitationsCard, ScopeCard } from "./checks-cards";
import { JudgingCard } from "./judging-card";
import { recentAnalyticsQuery } from "../overview/queries";
import { latencyNote } from "./state";

const settingsKey = ["admin", "systemone"];

export function SystemOnePage() {
  const isAdmin = useIsPlatformAdmin();
  const models = useModels();
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/systemone")) });
  const systemOneModels = (models.data ?? []).filter((m) => m.kind === "systemone");
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="SystemOne"
        description="A SystemOne model answers typed questions about text with calibrated probabilities: Grounded uses it to judge passages, check citations, spot out-of-scope questions and moderate. Each feature is off until a platform admin turns it on here for every agent, or an editor turns it on for one agent."
      />
      <QueryView
        query={models.isLoading ? models : settings}
        loadingLabel="Loading SystemOne settings…"
        empty={
          systemOneModels.length === 0 &&
          !settings.data?.modelId && (
            <Card>
              <EmptyState
                icon={<Sparkles />}
                title="No SystemOne model yet."
                description={
                  <>
                    Add a connection to a SystemOne service, then <TextLink render={<Link to="/admin/models" />}>add a model of kind SystemOne</TextLink>. Until then Grounded works without it.
                  </>
                }
              />
            </Card>
          )
        }
      >
        {settings.data && <SettingsEditor saved={settings.data} models={systemOneModels} isAdmin={isAdmin} />}
      </QueryView>
    </Stack>
  );
}

function useSave(saved: SystemOneSettings, onSaved: (st: SystemOneSettings) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: SettingsForm) => unwrap(await api.PUT("/v1/admin/systemone", { params: { header: ifMatch(saved.revision) }, body: settingsInput(form) })),
    onSuccess: (st) => {
      qc.setQueryData(settingsKey, st);
      qc.invalidateQueries({ queryKey: ["systemone", "status"] });
      toast.success("SystemOne settings saved");
      onSaved(st);
    },
  });
}

function SettingsEditor({ saved, models, isAdmin }: { saved: SystemOneSettings; models: Model[]; isAdmin: boolean }) {
  // Edits survive a change made elsewhere; SettingsPage asks whose to keep (AD-01).
  const [form, setForm, revision] = useRevisionForm(settingsForm(saved), saved.revision, {
    labels: { modelId: "Model", enabled: "Passage judging", candidates: "Candidates", mode: "Judging mode", timeoutMs: "Time limit per call (ms)", timeLimit: "Time limit (s)" },
    choices: { modelId: { "": "None", ...Object.fromEntries(models.map((m) => [m.id, m.displayName])) }, mode: modeLabels },
  });
  const [submitted, setSubmitted] = useState(false);
  const save = useSave(saved, (st) => setForm(settingsForm(st)));
  const analytics = useQuery(recentAnalyticsQuery());
  const problems = settingsProblems(form);
  const changes = settingsChanges(saved, form);
  const invalid = submitted && Object.keys(problems).length > 0;
  const set = (patch: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...patch }));
  const selected = models.find((m) => m.id === form.modelId);
  const t = analytics.data?.totals;
  const shown = submitted ? problems : {};
  const off = !isAdmin || !form.modelId;
  return (
    <SettingsPage
      revision={revision}
      dirty={changes > 0}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save settings"
      message={invalid ? `Not saved: ${Object.values(problems)[0]}` : changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      onSave={() => {
        setSubmitted(true);
        if (Object.keys(problems).length === 0) save.mutate(form);
      }}
      onDiscard={() => setForm(settingsForm(saved))}
    >
      <SettingsSection title="SystemOne model" description="The model every SystemOne feature uses. Moderation policies choose their provider on the Moderation page.">
        <Field label="Model" description="SystemOne models from Admin → Models." error={shown.modelId}>
          <NativeSelect disabled={!isAdmin} value={form.modelId} onChange={(e) => set({ modelId: e.target.value })}>
            <option value="">None (SystemOne features off)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.upstreamModel}){m.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {selected && !selected.enabled && (
          <Alert tone="warning" title="This model is disabled">
            Features that use it are skipped until it is enabled again.
          </Alert>
        )}
      </SettingsSection>
      <JudgingCard form={form} set={set} problems={shown} disabled={off} latency={latencyNote(t?.judging.latencyP50Ms)} agents={saved.agents.judging} />
      <CitationsCard form={form} set={set} problems={shown} disabled={off} latency={latencyNote(t?.citations.latencyP50Ms)} agents={saved.agents.citations} />
      <ScopeCard form={form} set={set} problems={shown} disabled={off} latency={latencyNote(t?.scope.latencyP50Ms)} agents={saved.agents.scope} />
      <SettingsSection
        title="Moderation"
        description="An audience's moderation policy can use a SystemOne model as its provider, with a severity threshold and a support message for self-harm."
        actions={
          <Button size="sm" variant="secondary" render={<Link to="/admin/moderation" />}>
            Open Moderation
          </Button>
        }
      >
        <p className={s.settingDescription}>{models.length ? "Choose it per audience on the Moderation page." : "Add a SystemOne model first."}</p>
      </SettingsSection>
    </SettingsPage>
  );
}
