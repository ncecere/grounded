/* The Versions tab: published versions, publishing with a note, viewing a version's configuration and reverting the draft to it. */
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, History, RotateCcw, Upload } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, api, unwrap } from "../../api/client";
import { formatDate } from "../../lib/format";
import { ActionMenu } from "@/components/templates/action-menu";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field, Form } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, TableActions, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../shared.module.css";
import { describeFilter } from "../team/filters";
import { ClassificationBadge, agentKey, useClassificationLevels, useTeam } from "../team/common";
import { type Agent, type AgentConfig, type AgentProblem, type AgentVersion, ProblemList, citationModeLabels, retrievalModeLabels } from "./common";
import type { AgentDraft } from "./draft";
import { publishAudienceText } from "./publish-state";
import { audienceLabel } from "@/lib/terms";
import { CompareVersions } from "./versions-compare";
import vs from "./versions.module.css";

const versionsKey = (team: string, id: string) => [...agentKey(team, id), "versions"];

/** A read-only summary of a configuration. */
export function ConfigSummary({ config, kbs, modelName }: { config: AgentConfig; kbs: { id: string; name: string; topK: number }[]; modelName: string }) {
  const rows: [string, string][] = [
    ["Model", modelName],
    ["Knowledge bases", kbs.map((k) => `${k.name || "Deleted knowledge base"} (${k.topK} results)`).join(", ") || "None"],
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

/** A published version as a record page (?record=<version>): its configuration, and Revert. */
function VersionPage({ agentId, version, onClose, onRevert }: { agentId: string; version: number; onClose: () => void; onRevert: (v: AgentVersion) => void }) {
  const { slug } = useTeam();
  const v = useQuery({
    queryKey: [...versionsKey(slug, agentId), version],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions/{version}", { params: { path: { team: slug, agentId, version } } })),
    enabled: Number.isInteger(version) && version > 0,
  });
  const invalid = !Number.isInteger(version) || version <= 0;
  return (
    <RecordPage
      open
      onClose={onClose}
      title={`Version ${version}`}
      description={v.data ? `Published ${formatDate(v.data.publishedAt)} by ${v.data.publishedByName || "someone"}.` : "A published version of this agent."}
      loading={v.isLoading}
      error={invalid ? new Error("This version doesn't exist, or the link is wrong.") : v.error}
      actions={
        v.data && (
          <Button variant="secondary" onClick={() => onRevert(v.data!)}>
            <RotateCcw aria-hidden /> Revert draft…
          </Button>
        )
      }
      sections={v.data ? [{ title: "Configuration", content: <ConfigSummary config={v.data.config} kbs={v.data.knowledgeBases} modelName={v.data.chatModelName} /> }] : []}
    />
  );
}

export function VersionsTab({ agent, d }: { agent: Agent; d: AgentDraft }) {
  const { slug } = useTeam();
  const levels = useClassificationLevels();
  const versions = useQuery({
    queryKey: versionsKey(slug, agent.id),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions", { params: { path: { team: slug, agentId: agent.id } } })),
  });
  const record = useRecordParam();
  const viewing = record.id === undefined ? null : Number(record.id);
  const [reverting, setReverting] = useState<AgentVersion | null>(null);
  const revert = useMutation({
    mutationFn: async (version: number) =>
      unwrap(await api.POST("/v1/teams/{team}/agents/{agentId}/revert", { params: { path: { team: slug, agentId: agent.id } }, body: { version } })),
    onSuccess: (next, version) => {
      d.adopt(next, true);
      setReverting(null);
      // Reverting to the live version leaves nothing to publish (P-09).
      toast.success(
        `The draft now matches version ${version}`,
        next.hasUnpublishedChanges ? "Test it, then publish to make it live." : "This is the live version: there are no unpublished changes.",
      );
    },
  });
  const list = versions.data ?? [];

  return (
    <div className={vs.tab}>
      <Card
        title="Versions"
        description={agent.published ? (agent.hasUnpublishedChanges ? "The draft has unpublished changes." : "The draft matches the live version.") : "Nothing is published yet."}
        flush
      >
        {agent.published && agent.hasUnpublishedChanges && (
          <div className={s.pad}>
            <Alert tone="info" title="Unpublished changes">
              People are chatting with version {agent.published.version}. Publish from the header to make your draft changes live.
            </Alert>
          </div>
        )}
        {versions.isLoading ? (
          <Loading label="Loading versions…" />
        ) : versions.error ? (
          <div className={s.pad}>
            <ErrorAlert error={versions.error} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState size="compact" icon={<History />} title="No versions yet" description="Publish the draft to create version 1." />
        ) : (
          <Table caption="Published versions" columns={[{ label: "Version", numeric: true }, "Note", "Published", "Classification", "Model", ""]}>
            {list.map((v) => (
              <Tr key={v.id}>
                <Td numeric>
                  <span className={s.badges}>
                    v{v.version}
                    {agent.published?.id === v.id && (
                      <Badge tone="success" size="sm">
                        Live
                      </Badge>
                    )}
                  </span>
                </Td>
                <Td>{v.note || <span className={s.muted}>No note</span>}</Td>
                <Td muted nowrap>
                  {formatDate(v.publishedAt)}
                  <span className={s.secondary}>{v.publishedByName || "Unknown"}</span>
                </Td>
                <Td>
                  <ClassificationBadge levels={levels.data} value={v.classification} />
                </Td>
                <Td muted nowrap>
                  {v.chatModelName}
                </Td>
                <Td nowrap>
                  {/* A "…" menu, so the note keeps the width at 1280 px. */}
                  <TableActions>
                    <ActionMenu
                      label={`Actions for version ${v.version}`}
                      actions={[
                        { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(String(v.version)) },
                        { label: "Revert draft…", icon: <RotateCcw aria-hidden />, onSelect: () => setReverting(v) },
                      ]}
                    />
                  </TableActions>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        {viewing !== null && <VersionPage agentId={agent.id} version={viewing} onClose={record.close} onRevert={setReverting} />}
        <AlertDialog
          open={reverting !== null}
          onOpenChange={(o) => {
            if (!o) {
              setReverting(null);
              revert.reset();
            }
          }}
          title={`Replace the draft with version ${reverting?.version}?`}
          description="Your current draft settings are overwritten. The live version doesn't change until you publish."
          confirmLabel="Revert draft"
          tone="primary"
          busy={revert.isPending}
          error={revert.error}
          onConfirm={() => reverting && revert.mutate(reverting.version)}
        />
      </Card>
      {list.length > 0 && <CompareVersions agent={agent} draft={d.draft.config} versions={list} />}
    </div>
  );
}
