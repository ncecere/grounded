/*
 * Publishing and versions: a configuration's read-only summary and the
 * Publish dialog (publishing with a note). The version history, a version's
 * record and Revert are in version-history.tsx, opened from the header's
 * version menu (version-menu.tsx; I6, docs/v0.2.1.md).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, api, unwrap } from "../../api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { describeFilter } from "../team/filters";
import { agentKey, useTeam } from "../team/common";
import { type Agent, type AgentConfig, type AgentProblem, ProblemList, citationModeLabels, retrievalModeLabels } from "./common";
import type { AgentDraft } from "./draft";
import { publishAudienceText } from "./publish-state";
import { audienceLabel } from "@/lib/terms";
import vs from "./versions.module.css";

export const versionsKey = (team: string, id: string) => [...agentKey(team, id), "versions"];

/** A read-only summary of a configuration. */
export function ConfigSummary({ config, kbs, modelName }: { config: AgentConfig; kbs: { id: string; name: string; topK: number; inherited?: boolean }[]; modelName: string }) {
  const rows: [string, string][] = [
    ["Model", modelName],
    ["Knowledge bases", kbs.map((k) => `${k.name || "Deleted knowledge base"} (${k.topK} results${k.inherited ? ", the knowledge base's" : ""})`).join(", ") || "None"],
    ["When to search", retrievalModeLabels[config.retrievalMode] + (config.retrievalMode === "tool" ? `, up to ${config.maxTurns} searches` : "")],
    ["Answer only from sources", config.strictlyGrounded ? `Yes. Refusal: “${config.refusalMessage}”` : "No"],
    ["Citations", citationModeLabels[config.citationMode]],
    ["Pinned filters", describeFilter(config.filters)],
    ["Temperature", config.temperature === undefined ? "Model default" : String(config.temperature)],
    ["Maximum answer length", config.maxOutputTokens ? `${config.maxOutputTokens.toLocaleString()} tokens` : "Model limit"],
    ["Source token budget", config.contextTokenBudget.toLocaleString()],
    ["Minimum similarity", config.minSimilarity ? String(config.minSimilarity) : "Off"],
    ["Rewrite follow-up questions", config.queryRewrite ? "Yes" : "No"],
  ];
  if (config.reasoningEffort) rows.push(["Reasoning effort", config.reasoningEffort]);
  return (
    <div className={vs.summary}>
      <dl className={vs.summaryList}>
        {rows.map(([k, v]) => (
          <div key={k} className={vs.summaryRow}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className={vs.summaryLabel}>Instructions</p>
        <pre className={vs.summaryInstructions}>{config.instructions || "None"}</pre>
      </div>
    </div>
  );
}

export function PublishDialog({ agent, d, onClose, onProblem }: { agent: Agent; d: AgentDraft; onClose: () => void; onProblem: (field: string) => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const formId = useId();
  const [note, setNote] = useState("");
  const publish = useMutation({
    mutationFn: async () => {
      await d.flush();
      return unwrap(await api.POST("/v1/teams/{team}/agents/{agentId}/publish", { params: { path: { team: slug, agentId: agent.id } }, body: { note: note.trim() || undefined } }));
    },
    onSuccess: async (version) => {
      qc.invalidateQueries({ queryKey: versionsKey(slug, agent.id) });
      qc.invalidateQueries({ queryKey: ["agent-directory"] });
      const fresh = await qc.fetchQuery({ queryKey: agentKey(slug, agent.id), queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}", { params: { path: { team: slug, agentId: agent.id } } })), staleTime: 0 });
      d.adopt(fresh);
      toast.success(`Version ${version.version} is live`, `${audienceLabel(fresh.audience)} can chat with it now.`);
      onClose();
    },
  });
  const problems: AgentProblem[] =
    publish.error instanceof ApiError && publish.error.code === "agent_invalid" ? ((publish.error.details?.problems as AgentProblem[] | undefined) ?? []) : [];
  const nothingNew = agent.published && !agent.hasUnpublishedChanges && d.status === "saved";

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={agent.published ? `Publish version ${agent.published.version + 1}?` : "Publish this agent?"}
      description={`${publishAudienceText[d.draft.config.audience]} Earlier versions stay available to view and revert to.`}
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={publish.isPending}>
            <Upload aria-hidden /> {publish.isPending && d.draft.config.audience === "public" ? "Checking public safety…" : "Publish"}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        {nothingNew && <Alert tone="info">The draft is the same as version {agent.published?.version}. Publishing makes an identical new version.</Alert>}
        <Field label="What changed?" labelHint="Optional" description="Shown in the version history.">
          <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {problems.length > 0 ? (
          <Alert tone="danger" title="The draft can't be published yet">
            <ProblemList
              problems={problems}
              onSelect={(f) => {
                onClose();
                onProblem(f);
              }}
            />
          </Alert>
        ) : (
          <ErrorAlert error={publish.error} />
        )}
      </Form>
    </Dialog>
  );
}
