/*
 * Admin → Models → Reranking (docs/v0.4.0.md §3): the rerank model every search uses, like the SystemOne model.
 * A notice above the list says whether searches are reranked; platform admins change it in a dialog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import type { Model } from "./common";

type RerankSettings = Schemas["RerankSettings"];

export const rerankSettingsKey = ["admin", "rerank"];

export function useRerankSettings() {
  return useQuery({ queryKey: rerankSettingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/rerank")) });
}

const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
const agentsText = (n: number) => (n === 1 ? "1 published agent reranks." : `${n.toLocaleString()} published agents rerank.`);

/** Shown to auditors beside the disabled button, the way locked Features switches say why. */
export const rerankLockedReason = "Only platform admins can change reranking.";

/** Whether searches are reranked, and with which model; nothing until a rerank model exists. */
export function RerankingNotice({ models, isAdmin }: { models: Model[]; isAdmin: boolean }) {
  const settings = useRerankSettings();
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const rerankModels = models.filter((m) => m.kind === "rerank");
  const st = settings.data;
  if (!st || (rerankModels.length === 0 && !st.modelId)) return null;
  const chosen = models.find((m) => m.id === st.modelId);
  // Auditors see the button disabled, with the reason in words (aud-8), not no button at all.
  const action = (
    <Button size="sm" variant="secondary" disabled={!isAdmin} aria-describedby={isAdmin ? undefined : reasonId} onClick={() => setOpen(true)}>
      <ArrowDownWideNarrow aria-hidden /> Reranking settings
    </Button>
  );
  const locked = !isAdmin && (
    <span id={reasonId} className={s.muted}>
      {" "}
      {rerankLockedReason}
    </span>
  );
  return (
    <>
      {chosen ? (
        <Alert id="reranking" tone={chosen.enabled ? "info" : "warning"} title="Reranking" actions={action}>
          {chosen.enabled
            ? `Searches rerank their best ${st.candidates} passages with ${chosen.displayName}, waiting at most ${seconds(st.timeLimitMs)}. ${agentsText(st.agents)}`
            : `${chosen.displayName} is disabled, so searches aren't reranked.`}
          {locked}
        </Alert>
      ) : (
        <Alert id="reranking" tone="info" title="Reranking is off" actions={action}>
          Choose a rerank model to rerank every search: agents, Try it, the retrieval API and MCP search.
          {locked}
        </Alert>
      )}
      {open && <RerankDialog saved={st} models={rerankModels} onClose={() => setOpen(false)} />}
    </>
  );
}

type Problems = { candidates?: string; timeLimitMs?: string };

const wholeIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

/** Each field's problem, checked before saving (the server checks the same ranges). */
export function rerankProblems(candidates: string, timeLimit: string): Problems {
  const out: Problems = {};
  if (!wholeIn(candidates, 5, 50)) out.candidates = "Enter a whole number from 5 to 50.";
  if (!wholeIn(timeLimit, 200, 10000)) out.timeLimitMs = "Enter a whole number of milliseconds from 200 to 10,000.";
  return out;
}

/** The server's problems by field (details.problems), for any it finds that the form didn't. */
function serverProblems(error: unknown): Problems {
  if (!(error instanceof ApiError) || error.code !== "invalid_settings") return {};
  const list = (error.details?.problems as { field: string; problem: string }[] | undefined) ?? [];
  return Object.fromEntries(list.map((p) => [p.field, p.problem.endsWith(".") ? p.problem : `${p.problem}.`]));
}

function RerankDialog({ saved, models, onClose }: { saved: RerankSettings; models: Model[]; onClose: () => void }) {
  const formId = useId();
  const qc = useQueryClient();
  const [modelId, setModelId] = useState(saved.modelId ?? "");
  const [candidates, setCandidates] = useState(String(saved.candidates));
  const [timeLimit, setTimeLimit] = useState(String(saved.timeLimitMs));
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/admin/rerank", {
          params: { header: ifMatch(saved.revision) },
          body: { modelId: modelId || null, candidates: Number(candidates), timeLimitMs: Number(timeLimit) },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(rerankSettingsKey, st);
      void qc.invalidateQueries({ queryKey: ["admin", "catalog-usage"] });
      void qc.invalidateQueries({ queryKey: ["rerank", "status"] });
      toast.success("Reranking settings saved");
      onClose();
    },
  });
  // Every problem at once, on its field (adm-5): the form's own checks after a save attempt, then the server's.
  const problems = { ...serverProblems(save.error), ...(submitted ? rerankProblems(candidates, timeLimit) : {}) };
  const fieldError = Object.keys(serverProblems(save.error)).length > 0;
  // Saving the same settings would still start a new revision (and retire every saved answer).
  const unchanged = (modelId || null) === (saved.modelId ?? null) && candidates.trim() === String(saved.candidates) && timeLimit.trim() === String(saved.timeLimitMs);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reranking settings"
      description="A rerank model reads the question with each passage and puts the best first. Agents can turn it off."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={save.isPending} disabled={unchanged}>
            Save settings
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          save.reset();
          if (Object.keys(rerankProblems(candidates, timeLimit)).length === 0) save.mutate();
        }}
      >
        <Stack gap={4}>
          <Field label="Rerank model" description="Rerank models from this page. Test one first.">
            <NativeSelect value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">None (searches aren't reranked)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.upstreamModel}){m.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Candidates" description="Passages a search fetches and reranks, 5 to 50." error={problems.candidates}>
            <NumberInput required min={5} max={50} maximumFractionDigits={0} value={candidates} onValueChange={setCandidates} />
          </Field>
          <Field label="Time limit" description="The longest a search waits, 200 to 10,000 ms. A slower or failed call keeps the usual order." error={problems.timeLimitMs}>
            <NumberInput required min={200} max={10000} maximumFractionDigits={0} unit="ms" value={timeLimit} onValueChange={setTimeLimit} />
          </Field>
          {/* Field problems show on their fields; anything else (a stale revision, a missing model) here. */}
          {!fieldError && <ErrorAlert error={save.error} />}
        </Stack>
      </form>
    </Dialog>
  );
}
