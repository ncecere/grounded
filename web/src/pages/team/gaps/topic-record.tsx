/*
 * A gap topic's record page (?record= on the Gaps page, docs/gaps.md): its
 * label, state, counts, signals, thumbs-down reasons and trend, the
 * questions their askers shared (never anything else of a question), and
 * its history (dismissals with their reasons, fixes, reopenings), which only
 * the team's editors, admins and owners see. The actions, for open topics:
 * Add a source (the main one: Data sources, with the topic as a note), Mark
 * fixed, and Dismiss, for now (it reopens when new questions about it fail)
 * or as not for this agent (it stays closed; new questions are still
 * counted). A closed topic can be reopened, which undoes either. Each
 * shared question can be added to one of the agent's evaluation sets.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { RecordPage } from "@/components/templates/record-page";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Sparkline } from "@/components/ui/sparkline/sparkline";
import { Time } from "@/components/ui/time/time";
import { toast } from "@/components/ui/toast/toast";
import { feedbackReasons } from "../../chat/stream";
import { plural } from "../common";
import { useCanAddToEvaluations } from "../evaluations/queries";
import { GapEvaluationDialog } from "./evaluation-dialog";
import {
  type GapDismissKind,
  type GapSharedQuestion,
  type GapTopic,
  type GapTopicEvent,
  dismissKindLabels,
  gapTopicQuery,
  gapTopicsKey,
  sinceClosedLabel,
  stateLabel,
  stateTones,
  topSignals,
  topicName,
  trendLabel,
} from "./queries";
import s from "./gaps.module.css";

type Props = { team: string; topicId: string | undefined; onClose: () => void };

export function GapTopicRecord({ team, topicId, onClose }: Props) {
  const q = useQuery({ ...gapTopicQuery(team, topicId ?? ""), enabled: Boolean(topicId) });
  const [dismissing, setDismissing] = useState(false);
  const [adding, setAdding] = useState<GapSharedQuestion | null>(null);
  const actions = useTopicActions(team, topicId ?? "");
  const t = q.data?.topic;
  const history = q.data?.history ?? [];
  return (
    <RecordPage
      open={Boolean(topicId)}
      onClose={onClose}
      title={t ? topicName(t) : "Topic"}
      description={t ? `Questions to ${t.agentName} that failed, grouped by meaning. Only questions their askers shared are shown.` : "A gap topic."}
      meta={t && <Badge tone={stateTones[t.state]}>{stateLabel(t)}</Badge>}
      // Always back to the Gaps page: the tab it was opened from may no longer hold it (aud-11).
      back={{ label: "Gaps", href: `/teams/${team}/gaps` }}
      loading={q.isLoading}
      error={q.error}
      facts={t ? topicFacts(t) : []}
      actions={
        t?.state === "open" ? (
          <>
            <Button variant="secondary" onClick={() => setDismissing(true)}>
              Dismiss
            </Button>
            <Button variant="secondary" loading={actions.fix.isPending} onClick={() => actions.fix.mutate()}>
              Mark fixed
            </Button>
            <Button loading={actions.addSource.isPending} onClick={() => actions.addSource.mutate(t)}>
              Add a source
            </Button>
          </>
        ) : (
          t && (
            <Button variant="secondary" loading={actions.reopen.isPending} onClick={() => actions.reopen.mutate()}>
              Reopen
            </Button>
          )
        )
      }
      sections={
        t && [
          { title: "Why they failed", content: <Signals topic={t} /> },
          { title: "Shared questions", content: <SharedQuestions team={team} questions={q.data?.sharedQuestions ?? []} onAdd={setAdding} /> },
          { title: "History", content: <History events={history} />, hidden: history.length === 0 },
        ]
      }
    >
      <ApiErrorAlert error={actions.fix.error ?? actions.addSource.error ?? actions.reopen.error} />
      {dismissing && t && <DismissDialog team={team} topic={t} onClose={() => setDismissing(false)} />}
      {adding && t && <GapEvaluationDialog team={team} topic={t} question={adding} onClose={() => setAdding(null)} />}
    </RecordPage>
  );
}

function topicFacts(t: GapTopic) {
  const since = sinceClosedLabel(t);
  return [
    { label: "Agent", value: t.agentName },
    { label: "Questions", value: `${plural(t.questions, "question")} from ${plural(t.askers, "person", "people")} (${t.last30Days} in the last 30 days)` },
    ...(since ? [{ label: "Since it closed", value: since }] : []),
    { label: "Shared", value: plural(t.shared, "question") },
    { label: "First asked", value: <Time value={t.firstSeen} format="datetime" /> },
    { label: "Last asked", value: <Time value={t.lastSeen} format="datetime" /> },
    { label: "Last 8 weeks", value: <Sparkline className={s.trend} size="sm" values={t.trend} label={trendLabel(t.trend)} /> },
  ];
}

function Signals({ topic }: { topic: GapTopic }) {
  const reasons = Object.entries(topic.reasons).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <p className={s.signals}>
        {topSignals(topic.signals).map((x) => (
          <Badge key={x.key} tone="neutral">
            {x.label} · {x.count}
          </Badge>
        ))}
      </p>
      {reasons.length > 0 && (
        <p className={s.muted}>
          Thumbs-down reasons: {reasons.map(([r, n]) => `${feedbackReasons.find((f) => f.value === r)?.label ?? r} (${n})`).join(", ")}.
        </p>
      )}
    </>
  );
}

function SharedQuestions({ team, questions, onAdd }: { team: string; questions: GapSharedQuestion[]; onAdd: (q: GapSharedQuestion) => void }) {
  const canAdd = useCanAddToEvaluations(team);
  if (questions.length === 0) return <p className={s.muted}>No one shared their question. People can share one when they give an answer a thumbs-down.</p>;
  return (
    <ul className={s.shared}>
      {questions.map((q) => (
        <li key={q.id} className={s.sharedItem}>
          <p className={s.question}>
            {q.question}
            <span className={s.questionMeta}>
              <Time value={q.createdAt} format="datetime" />
              {q.feedbackReason && ` · ${feedbackReasons.find((f) => f.value === q.feedbackReason)?.label ?? q.feedbackReason}`}
            </span>
          </p>
          {q.addedToEvaluations ? (
            <Badge tone="success">Added to evaluations</Badge>
          ) : (
            canAdd && (
              <Button size="sm" variant="secondary" onClick={() => onAdd(q)}>
                Add to evaluations
              </Button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

/** A history line in words: "Dismissed for now by Casey Lee", "Reopened by a new failed question". */
export function eventText(e: GapTopicEvent): string {
  const by = e.by ? ` by ${e.by}` : "";
  switch (e.kind) {
    case "dismissed":
      return `${e.dismissKind ? dismissKindLabels[e.dismissKind] : "Dismissed"}${by}`;
    case "fixed":
      return `Marked fixed${by}`;
    case "reopened":
      return e.by ? `Reopened${by}` : "Reopened by a new failed question";
    case "resolved":
      return "Closed itself: its questions are answered now";
    case "merged":
      return "A similar topic was merged into it";
  }
}

function History({ events }: { events: GapTopicEvent[] }) {
  return (
    <>
      <ul className={s.history}>
        {events.map((e) => (
          <li key={e.id}>
            {eventText(e)}, <Time value={e.at} format="datetime" />.
            {e.reason && <span className={s.historyReason}>Reason: {e.reason}</span>}
          </li>
        ))}
      </ul>
      <p className={s.questionMeta}>Only your team's editors, admins and owners see this history.</p>
    </>
  );
}

function useTopicActions(team: string, topicId: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const path = { team, topicId };
  const done = () => void qc.invalidateQueries({ queryKey: gapTopicsKey(team) });
  return {
    fix: useMutation({
      mutationFn: async () => unwrap(await api.POST("/v1/teams/{team}/gap-topics/{topicId}/fix", { params: { path } })),
      onSuccess: () => {
        done();
        toast.success("Marked fixed", "It reopens if people's questions about it fail again.");
      },
    }),
    reopen: useMutation({
      mutationFn: async () => unwrap(await api.POST("/v1/teams/{team}/gap-topics/{topicId}/reopen", { params: { path } })),
      onSuccess: () => {
        done();
        toast.success("Topic reopened");
      },
    }),
    // The topic's label goes in the address, as a note on Data sources only: it is never saved with a source (aud-3).
    addSource: useMutation({
      mutationFn: async (t: GapTopic) => {
        unwrap(await api.POST("/v1/teams/{team}/gap-topics/{topicId}/add-source", { params: { path } }));
        return t;
      },
      onSuccess: (t) => void navigate({ to: "/teams/$team/sources", params: { team }, search: { gap: topicName(t), agent: t.agentName } as never }),
    }),
  };
}

const kindOptions: { value: GapDismissKind; label: string; description: string }[] = [
  { value: "for_now", label: "Dismiss for now", description: "It reopens when new questions about it fail." },
  { value: "not_for_agent", label: "Not for this agent", description: "The agent isn't meant to answer this. It stays closed; new questions are still counted." },
];

function DismissDialog({ team, topic, onClose }: { team: string; topic: GapTopic; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<GapDismissKind>("for_now");
  const dismiss = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/gap-topics/{topicId}/dismiss", { params: { path: { team, topicId: topic.id } }, body: { kind, reason: reason.trim() } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gapTopicsKey(team) });
      toast.success(
        "Topic dismissed",
        kind === "for_now" ? "It reopens if new questions about it fail. You can reopen it from its page." : "It stays closed. You can reopen it from its page.",
      );
      onClose();
    },
  });
  return (
    <FormDialog title="Dismiss this topic?" description={`${topicName(topic)} leaves the open topics.`} onClose={onClose} submitLabel="Dismiss"
      busy={dismiss.isPending} onSubmit={() => dismiss.mutate()}>
      <ApiErrorAlert error={dismiss.error} />
      <RadioGroup<GapDismissKind> legend="How long" value={kind} onValueChange={setKind} options={kindOptions} />
      <Field label="Reason" labelHint="Optional" description="Kept in the topic's history. Only your team's editors, admins and owners see it.">
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
