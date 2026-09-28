/*
 * The agent editor (D2, D3): a DetailPage with the status, save state and
 * Chat · Test · Publish in the header, one facts line, and the pill tabs
 * Build · Appearance · Share · Versions · Analytics. Build is the
 * configuration beside a live Test chat.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { BarChart3, Hammer, History, Palette, Power, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { DetailPage } from "@/components/templates/detail-page";
import { RelativeTime } from "@/components/templates/list-page";
import { useUrlTab } from "@/components/page-tabs";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { editorTabs } from "@/lib/tabs";
import { audienceLabel } from "@/lib/terms";
import { useSearchParams } from "@/lib/url-search";
import s from "../shared.module.css";
import { ArchivedNotice, PageSkeleton } from "../team/layout";
import { agentQuery, useTeam } from "../team/common";
import { AnalyticsTab } from "./analytics/tab";
import { AppearanceTab } from "./appearance";
import { type BuildSection, fieldPlace } from "./build/section";
import { BuildTab, useWideBuild } from "./build/tab";
import { type Agent, AgentStatusBadge, ProblemList, focusField, problemTarget, useChatModels } from "./common";
import { useAgentDraft } from "./draft";
import { DeleteAgent, StatusDialog } from "./editor-dialogs";
import { ChatButton, EditorAlerts, HeaderActions, SaveIndicator } from "./editor-header";
import { publishBlocked } from "./publish-state";
import { ShareTab } from "./share/share-tab";
import { ConfigSummary, PublishDialog, VersionsTab } from "./versions";
import a from "./agents.module.css";

export function AgentEditorPage() {
  const { agentId } = useParams({ from: "/app/teams/$team/agents/$agentId" });
  const { slug } = useTeam();
  const agent = useQuery(agentQuery(slug, agentId));
  if (agent.isLoading) return <PageSkeleton />;
  if (isNotFound(agent.error) || (!agent.error && !agent.data)) return <NotFoundState what="agent" />;
  if (agent.error || !agent.data) return <ErrorAlert error={agent.error} title="Couldn't load this agent" />;
  // Keyed by ID so switching agents starts a fresh draft.
  return <Editor key={agent.data.id} agent={agent.data} />;
}

/** The Test drawer's state in ?test=open, so Back closes it and "land on Build with Test open" is a link (W9). */
function useTestParam(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const open = params.get("test") === "open";
  const set = (next: boolean) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (next) out.set("test", "open");
        else out.delete("test");
        return out;
      },
      { replace: !next },
    );
  return [open, set];
}

function Editor({ agent }: { agent: Agent }) {
  const { slug, canEdit, isManager, role, archived } = useTeam();
  const [tab, setTab] = useUrlTab(editorTabs);
  const [testOpen, setTestOpen] = useTestParam();
  const wide = useWideBuild();
  const [sections, setSections] = useState<BuildSection[]>(["instructions"]);
  const d = useAgentDraft(slug, agent);
  const current = useQuery(agentQuery(slug, agent.id)).data ?? agent;
  const models = useChatModels();
  const [publishing, setPublishing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const live = current.status === "active" && Boolean(current.published);

  /** Opens the tab and Build section a problem points to, then focuses its control. */
  const goToField = (field: string) => {
    const place = fieldPlace(problemTarget(field).id);
    if (place.section) setSections((open) => (open.includes(place.section!) ? open : [...open, place.section!]));
    if (!wide && testOpen) setTestOpen(false);
    setTab(place.tab);
    // Focus after the tab switch and the section opening; again after a closing dialog has restored focus.
    setTimeout(() => focusField(field), 80);
    setTimeout(() => {
      const target = document.getElementById(problemTarget(field).id);
      if (target && !target.contains(document.activeElement)) focusField(field);
    }, 350);
  };

  if (!canEdit) {
    return (
      <Stack gap={6} className={s.page}>
        <PageHeader title={current.name} description={current.description || undefined} meta={<AgentStatusBadge agent={current} />} actions={live ? <ChatButton agent={current} /> : undefined} />
        {/* The same reason every team page gives for an archived team (F-16). */}
        {archived ? <ArchivedNotice>Its agents can be viewed but not changed.</ArchivedNotice> : <Alert tone="info">Only editors, admins and owners can configure agents.</Alert>}
        {current.published && <ConfigSummary config={current.published.config} kbs={current.published.knowledgeBases} modelName={current.published.chatModelName} />}
      </Stack>
    );
  }

  const c = d.draft.config;
  const blocked = publishBlocked({ agent: current, status: d.status, needsFix: d.held || d.invalidFields.length > 0, audience: c.audience, isManager });
  const draftWarnings = current.warnings.filter((w) => w.field !== "published");
  const model = models.data?.find((m) => m.id === c.chatModelId);

  return (
    <>
      <DetailPage
        title={current.name}
        description={current.description || undefined}
        meta={
          <>
            <AgentStatusBadge agent={current} />
            {current.published && <Badge variant="outline">v{current.published.version} live</Badge>}
            {current.published && current.hasUnpublishedChanges && <Badge tone="info">Unpublished changes</Badge>}
            <SaveIndicator d={d} />
          </>
        }
        facts={[
          { label: "Audience", value: current.published ? audienceLabel(current.audience) : `${audienceLabel(c.audience)} (when published)` },
          { label: "Model", value: c.chatModelId ? (model?.displayName ?? (models.isLoading ? undefined : "Unavailable model")) : "No model" },
          { label: "Knowledge", value: `${c.kbs.length} knowledge base${c.kbs.length === 1 ? "" : "s"}` },
          { label: "Updated", value: <>Updated <RelativeTime value={current.updatedAt} /></> },
        ]}
        primaryAction={
          <HeaderActions
            current={current}
            live={live}
            blocked={blocked}
            onPublish={() => setPublishing(true)}
            onTest={tab === "build" && !wide ? () => setTestOpen(true) : undefined}
          />
        }
        menuActions={[
          {
            label: current.status === "active" ? "Disable agent" : "Enable agent",
            icon: <Power aria-hidden />,
            onSelect: () => setStatusOpen(true),
            disabled: current.status === "disabled_by_platform",
            disabledReason: "Only a platform admin can enable it",
            hidden: !isManager,
          },
          { label: "Delete agent…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setDeleting(true), hidden: !isManager },
        ]}
        notices={
          <>
            {!isManager && current.published && current.audience !== "team" && (
              <Alert tone="info">Only team admins and owners can change this agent's audience or publish it beyond the team.</Alert>
            )}
            <EditorAlerts current={current} d={d} onProblem={goToField} />
          </>
        }
        tabIds={editorTabs}
        tabsLabel="Agent sections"
        tabs={[
          {
            value: "build",
            label: "Build",
            icon: <Hammer aria-hidden />,
            count: draftWarnings.length || undefined,
            content: (
              <div className={a.stack}>
                {draftWarnings.length > 0 && (
                  <Alert tone="warning" title="Fix these before publishing">
                    <ProblemList problems={draftWarnings} onSelect={goToField} />
                  </Alert>
                )}
                <BuildTab agent={current} d={d} sections={sections} onSectionsChange={setSections} onProblem={goToField} testOpen={testOpen} onTestOpenChange={setTestOpen} />
              </div>
            ),
          },
          { value: "appearance", label: "Appearance", icon: <Palette aria-hidden />, content: <AppearanceTab key={d.epoch} d={d} /> },
          { value: "share", label: "Share", icon: <Share2 aria-hidden />, content: <ShareTab key={d.epoch} agent={current} d={d} /> },
          { value: "versions", label: "Versions", icon: <History aria-hidden />, content: <VersionsTab agent={current} d={d} /> },
          {
            value: "analytics",
            label: "Analytics",
            icon: <BarChart3 aria-hidden />,
            hidden: !(canEdit || role === "admin" || role === "owner"),
            content: <AnalyticsTab agent={current} />,
          },
        ]}
      />
      {publishing && <PublishDialog agent={current} d={d} onClose={() => setPublishing(false)} onProblem={goToField} />}
      {statusOpen && <StatusDialog agent={current} d={d} onClose={() => setStatusOpen(false)} />}
      <DeleteAgent agent={current} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
