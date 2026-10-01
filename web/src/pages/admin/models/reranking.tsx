/*
 * Admin → Models → Reranking (docs/v0.4.0.md §3): the rerank model every search uses, like the SystemOne model.
 * A notice above the list says whether searches are reranked; platform admins change it in a dialog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow } from "lucide-react";
import { useId, useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { toast } from "@/components/ui/toast/toast";
import type { Model } from "./common";

type RerankSettings = Schemas["RerankSettings"];

export const rerankSettingsKey = ["admin", "rerank"];

export function useRerankSettings() {
  return useQuery({ queryKey: rerankSettingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/rerank")) });
}

const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
const agentsText = (n: number) => (n === 1 ? "1 published agent reranks." : `${n.toLocaleString()} published agents rerank.`);

/** Whether searches are reranked, and with which model; nothing until a rerank model exists. */
export function RerankingNotice({ models, isAdmin }: { models: Model[]; isAdmin: boolean }) {
  const settings = useRerankSettings();
  const [open, setOpen] = useState(false);
  const rerankModels = models.filter((m) => m.kind === "rerank");
  const st = settings.data;
  if (!st || (rerankModels.length === 0 && !st.modelId)) return null;
  const chosen = models.find((m) => m.id === st.modelId);
  const action = isAdmin && (
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
      <ArrowDownWideNarrow aria-hidden /> Reranking settings
    </Button>
  );
  return (
    <>
      {chosen ? (
        <Alert tone={chosen.enabled ? "info" : "warning"} title="Reranking" actions={action}>
          {chosen.enabled
            ? `Searches rerank their best ${st.candidates} passages with ${chosen.displayName}, waiting at most ${seconds(st.timeLimitMs)}. ${agentsText(st.agents)}`
            : `${chosen.displayName} is disabled, so searches aren't reranked.`}
        </Alert>
      ) : (
        <Alert tone="info" title="Reranking is off" actions={action}>
          Choose a rerank model to rerank every search: agents, Try it, the retrieval API and MCP search.
        </Alert>
      )}
      {open && <RerankDialog saved={st} models={rerankModels} onClose={() => setOpen(false)} />}
    </>
  );
}

function RerankDialog({ saved, models, onClose }: { saved: RerankSettings; models: Model[]; onClose: () => void }) {
  const formId = useId();
  const qc = useQueryClient();
  const [modelId, setModelId] = useState(saved.modelId ?? "");
  const [candidates, setCandidates] = useState(String(saved.candidates));
  const [timeLimit, setTimeLimit] = useState(String(saved.timeLimitMs));
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
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reranking settings"
      description="A rerank model reads the question with each passage and puts the best first. Agents can turn it off."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={save.isPending}>
            Save settings
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
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
          <Field label="Candidates" description="Passages a search fetches and reranks, 5 to 50.">
            <NumberInput required min={5} max={50} maximumFractionDigits={0} value={candidates} onValueChange={setCandidates} />
          </Field>
          <Field label="Time limit" description="The longest a search waits, 200 to 10,000 ms. A slower or failed call keeps the usual order.">
            <NumberInput required min={200} max={10000} maximumFractionDigits={0} unit="ms" value={timeLimit} onValueChange={setTimeLimit} />
          </Field>
          <ErrorAlert error={save.error} />
        </Stack>
      </form>
    </Dialog>
  );
}
