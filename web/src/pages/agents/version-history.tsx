/*
 * An agent's version history (I6, docs/v0.2.1.md): a record page over the
 * editor, opened from the header's version menu. ?history=versions lists the
 * published versions (with Compare under them), ?history=compare opens the
 * comparison alone, and ?version=<n> opens one version's configuration on
 * top, with Revert. The old Versions tab's links (?tab=versions, with
 * ?record=<n>) redirect here (router.tsx). Reverting replaces the draft; the
 * live version doesn't change until Publish.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, History, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { api, unwrap } from "../../api/client";
import { formatDate } from "../../lib/format";
import { ActionMenu } from "@/components/templates/action-menu";
import { RelativeTime } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, TableActions, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import s from "../shared.module.css";
import { ClassificationBadge, useClassificationLevels, useTeam } from "../team/common";
import type { Agent, AgentVersion } from "./common";
import type { AgentDraft } from "./draft";
import { ConfigSummary, versionsKey } from "./versions";
import { CompareVersions } from "./versions-compare";
import { revertReason } from "./version-menu";
import vs from "./versions.module.css";

/** The history's URL parameter and its views. */
export const HISTORY_PARAM = "history";
export const VERSION_PARAM = "version";
export type HistoryView = "versions" | "compare";

/** ?history=versions|compare: open(view), close(). */
export const useHistoryParam = () => useRecordParam(HISTORY_PARAM);

export function useVersions(agentId: string) {
  const { slug } = useTeam();
  return useQuery({
    queryKey: versionsKey(slug, agentId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions", { params: { path: { team: slug, agentId } } })),
  });
}

/** "Revert draft…": ask(version) opens the confirmation; `dialog` renders it. */
export function useRevertDraft(agent: Agent, d: AgentDraft) {
  const { slug } = useTeam();
  const [reverting, setReverting] = useState<number | null>(null);
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
  const dialog = (
    <AlertDialog
      open={reverting !== null}
      onOpenChange={(o) => {
        if (!o) {
          setReverting(null);
          revert.reset();
        }
      }}
      title={`Replace the draft with version ${reverting}?`}
      description="Your current draft settings are overwritten. The live version doesn't change until you publish."
      confirmLabel="Revert draft"
      tone="primary"
      busy={revert.isPending}
      error={revert.error}
      onConfirm={() => reverting !== null && revert.mutate(reverting)}
    />
  );
  return { ask: (version: number) => setReverting(version), dialog };
}

/** "Revert draft to v3…"; while the draft already matches the version, focusable but disabled, with the reason (P-04). */
function RevertButton({ version, reason, onRevert }: { version: number; reason?: string; onRevert: (v: number) => void }) {
  const reasonId = useId();
  const label = `Revert draft to v${version}…`;
  if (!reason)
    return (
      <Button variant="secondary" onClick={() => onRevert(version)}>
        <RotateCcw aria-hidden /> {label}
      </Button>
    );
  return (
    <>
      <Tooltip content={reason}>
        {/* A non-native button: aria-disabled and focusable, activation cancelled. */}
        <Button variant="secondary" disabled render={<button type="button" />} aria-describedby={reasonId}>
          <RotateCcw aria-hidden /> {label}
        </Button>
      </Tooltip>
      <VisuallyHidden id={reasonId}>{reason}</VisuallyHidden>
    </>
  );
}

/** A published version as a record page over the history (?version=<n>): its configuration, and Revert. */
function VersionRecord({ agent, version, onClose, onRevert }: { agent: Agent; version: number; onClose: () => void; onRevert: (v: number) => void }) {
  const { slug } = useTeam();
  const agentId = agent.id;
  const invalid = !Number.isInteger(version) || version <= 0;
  const v = useQuery({
    queryKey: [...versionsKey(slug, agentId), version],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions/{version}", { params: { path: { team: slug, agentId, version } } })),
    enabled: !invalid,
  });
  return (
    <RecordPage
      open
      param={VERSION_PARAM}
      onClose={onClose}
      title={`Version ${version}`}
      description={v.data ? `Published ${formatDate(v.data.publishedAt)} by ${v.data.publishedByName || "someone"}.` : "A published version of this agent."}
      loading={v.isLoading}
      error={invalid ? new Error("This version doesn't exist, or the link is wrong.") : v.error}
      actions={v.data && <RevertButton version={v.data.version} reason={revertReason(agent, v.data.version)} onRevert={onRevert} />}
      sections={v.data ? [{ title: "Configuration", content: <ConfigSummary config={v.data.config} kbs={v.data.knowledgeBases} modelName={v.data.chatModelName} /> }] : []}
    />
  );
}

function VersionsTable({ agent, list, onView, onRevert }: { agent: Agent; list: AgentVersion[]; onView: (v: number) => void; onRevert: (v: number) => void }) {
  const levels = useClassificationLevels();
  return (
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
            <RelativeTime value={v.publishedAt} />
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
                  { label: "View details", icon: <Eye aria-hidden />, onSelect: () => onView(v.version) },
                  {
                    label: `Revert draft to v${v.version}…`,
                    icon: <RotateCcw aria-hidden />,
                    onSelect: () => onRevert(v.version),
                    disabled: Boolean(revertReason(agent, v.version)),
                    disabledReason: revertReason(agent, v.version),
                  },
                ]}
              />
            </TableActions>
          </Td>
        </Tr>
      ))}
    </Table>
  );
}

/** The history page: the published versions and Compare (?history=versions), or Compare alone (?history=compare). */
export function VersionHistory({ agent, d, view, onClose, onRevert }: { agent: Agent; d: AgentDraft; view: HistoryView; onClose: () => void; onRevert: (v: number) => void }) {
  const versions = useVersions(agent.id);
  const record = useRecordParam(VERSION_PARAM);
  const viewing = record.id === undefined ? null : Number(record.id);
  const list = versions.data ?? [];
  const status = agent.published ? (agent.hasUnpublishedChanges ? "The draft has unpublished changes." : "The draft matches the live version.") : "Nothing is published yet.";
  const compare = view === "compare";
  return (
    <>
      <RecordPage
        open
        param={HISTORY_PARAM}
        onClose={onClose}
        title={compare ? "Compare versions" : "Version history"}
        description={compare ? "What changed between two versions, or between a version and the draft." : `The published versions of ${agent.name}. ${status}`}
        loading={versions.isLoading}
        error={versions.error}
      >
        {!compare && (
          <Card title="Published versions" titleAs="h2" flush>
            {agent.published && agent.hasUnpublishedChanges && (
              <div className={s.pad}>
                <Alert tone="info" title="Unpublished changes">
                  People are chatting with version {agent.published.version}. Publish from the editor's header to make your draft changes live.
                </Alert>
              </div>
            )}
            {list.length === 0 ? (
              <EmptyState size="compact" icon={<History />} title="No versions yet." description="Publish the draft to create version 1." />
            ) : (
              <VersionsTable agent={agent} list={list} onView={(v) => record.open(String(v))} onRevert={onRevert} />
            )}
          </Card>
        )}
        {list.length > 0 ? (
          <div className={vs.tab}>
            <CompareVersions agent={agent} draft={d.draft.config} versions={list} describe={!compare} />
          </div>
        ) : (
          compare && <EmptyState size="compact" icon={<History />} title="Nothing to compare yet." description="Publish the draft to create version 1." />
        )}
      </RecordPage>
      {viewing !== null && <VersionRecord agent={agent} version={viewing} onClose={record.close} onRevert={onRevert} />}
    </>
  );
}
