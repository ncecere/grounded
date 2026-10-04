/*
 * The team's Gaps page (docs/gaps.md, docs/v0.4.0.md §2): what the team's
 * agents fail to answer, grouped into topics. Pill tabs (?tab=): Open and
 * Closed (dismissed, fixed or answered now). A topic shows once at least 3
 * different people asked about it, with its label, signals and trend, never
 * a question's text unless its asker shared it; ?record= opens a topic.
 * Settings (?tab=settings): confirming similar questions with SystemOne.
 * Editors, admins and owners; others get the not-found page.
 */
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Settings } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { gapTabs } from "@/lib/tabs";
import sh from "../../shared.module.css";
import { EditorsOnlyState } from "../access";
import { useTeam } from "../common";
import { type GapFilter, gapTopicsQuery, pendingNote } from "./queries";
import { GapSettingsTab } from "./settings";
import { GapTopicRecord } from "./topic-record";
import { GapTopicsTable } from "./topics-table";

export const gapsDescription =
  "Questions your agents couldn't answer well, grouped into topics, so you know what to add. A topic shows once at least 3 different people asked about it; you see its questions only when people shared them.";

export function TeamGapsPage() {
  const { slug, role } = useTeam();
  const [tab, setTab] = useUrlTab(gapTabs);
  const record = useRecordParam();
  const editor = role === "editor" || role === "admin" || role === "owner";
  if (role === "member") return <EditorsOnlyState title="Gaps" what="gaps" />;
  if (!editor) return <NotFoundState />;
  return (
    <Stack gap={6} className={sh.page}>
      <PageHeader title="Gaps" description={gapsDescription} />
      <PageTabs
        label="Gap topics"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "open", label: "Open", icon: <CircleAlert aria-hidden />, content: <Topics team={slug} state="open" /> },
          { value: "closed", label: "Closed", icon: <CircleCheck aria-hidden />, content: <Topics team={slug} state="closed" /> },
          { value: "settings", label: "Settings", icon: <Settings aria-hidden />, content: <GapSettingsTab team={slug} /> },
        ]}
      />
      <GapTopicRecord team={slug} topicId={record.id} onClose={record.close} />
    </Stack>
  );
}

function Topics({ team, state }: { team: string; state: GapFilter }) {
  const q = useQuery(gapTopicsQuery(team, { state }));
  const note = state === "open" && q.data ? pendingNote(q.data) : undefined;
  return (
    <Stack gap={4}>
      {note && (
        <Alert tone="info" title={note.title}>
          {note.detail}
        </Alert>
      )}
      <GapTopicsTable
        team={team}
        topics={q.data?.topics ?? []}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        inPlace
        showState={state === "closed"}
        emptyTitle={state === "open" ? "No open topics." : "No closed topics."}
        emptyDescription={
          state === "open"
            ? "When several people ask your agents something they can't answer, the topic shows here."
            : "Topics you dismiss or mark fixed, and topics whose questions are answered now, show here. You can reopen them."
        }
      />
    </Stack>
  );
}
