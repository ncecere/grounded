/*
 * The team's Gaps page (docs/gaps.md, docs/v0.4.0.md §2): what the team's
 * agents fail to answer, grouped into topics. Pill tabs (?tab=): Open and
 * Closed (dismissed, fixed or answered now). A topic shows once at least 3
 * different people asked about it, with its label, signals and trend, never
 * a question's text unless its asker shared it; ?record= opens a topic.
 * Editors, admins and owners; others get the not-found page.
 */
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { gapTabs } from "@/lib/tabs";
import sh from "../../shared.module.css";
import { plural, useTeam } from "../common";
import { type GapFilter, gapTopicsQuery } from "./queries";
import { GapTopicRecord } from "./topic-record";
import { GapTopicsTable } from "./topics-table";

export const gapsDescription =
  "Questions your agents couldn't answer well, grouped into topics, so you know what to add. A topic shows once at least 3 different people asked about it; you see its questions only when people shared them.";

export function TeamGapsPage() {
  const { slug, role } = useTeam();
  const [tab, setTab] = useUrlTab(gapTabs);
  const record = useRecordParam();
  const editor = role === "editor" || role === "admin" || role === "owner";
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
        ]}
      />
      <GapTopicRecord team={slug} topicId={record.id} onClose={record.close} />
    </Stack>
  );
}

function Topics({ team, state }: { team: string; state: GapFilter }) {
  const q = useQuery(gapTopicsQuery(team, { state }));
  const pending = q.data?.pending ?? 0;
  return (
    <Stack gap={4}>
      {state === "open" && pending > 0 && (
        <Alert tone="info" title={`${plural(pending, "failed question")} in the last 30 days aren't in a topic yet.`}>
          Questions are grouped every hour, and a topic shows once {q.data?.minAskers ?? 3} different people asked about it.
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
            : "Topics you dismiss or mark fixed, and topics whose questions are answered now, show here."
        }
      />
    </Stack>
  );
}
