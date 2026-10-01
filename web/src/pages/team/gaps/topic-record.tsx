/*
 * A gap topic's record page (?record= on the Gaps page, docs/gaps.md): its
 * label, state, counts, signals, thumbs-down reasons and trend, and the
 * questions their askers shared (never anything else of a question). The
 * actions, for open topics: Add a source (the main one: Data sources, with
 * the topic as a note), Mark fixed and Dismiss (with an optional reason).
 * A closed topic reopens by itself on new failures. Each shared question
 * can be added to one of the agent's evaluation sets.
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
import { Sparkline } from "@/components/ui/sparkline/sparkline";
import { Time } from "@/components/ui/time/time";
import { toast } from "@/components/ui/toast/toast";
import { feedbackReasons } from "../../chat/stream";
import { plural } from "../common";
import { useCanAddToEvaluations } from "../evaluations/queries";
import { GapEvaluationDialog } from "./evaluation-dialog";
import { type GapSharedQuestion, type GapTopic, gapTopicQuery, gapTopicsKey, stateLabels, stateTones, topSignals, topicName, trendLabel } from "./queries";
import s from "./gaps.module.css";

type Props = { team: string; topicId: string | undefined; onClose: () => void };

export function GapTopicRecord({ team, topicId, onClose }: Props) {
  const q = useQuery({ ...gapTopicQuery(team, topicId ?? ""), enabled: Boolean(topicId) });
  const [dismissing, setDismissing] = useState(false);
  const [adding, setAdding] = useState<GapSharedQuestion | null>(null);
  const actions = useTopicActions(team, topicId ?? "");
  const t = q.data?.topic;
  return (
    <RecordPage
      open={Boolean(topicId)}
      onClose={onClose}
      title={t ? topicName(t) : "Topic"}
      description={t ? `Questions to ${t.agentName} that failed, grouped by meaning. Only questions their askers shared are shown.` : "A gap topic."}
      meta={t && <Badge tone={stateTones[t.state]}>{stateLabels[t.state]}</Badge>}
      loading={q.isLoading}
      error={q.error}
      facts={t ? topicFacts(t) : []}
      actions={
        t?.state === "open" && (
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
        )
      }
      sections={
        t && [
          { title: "Why they failed", content: <Signals topic={t} /> },
          { title: "Shared questions", content: <SharedQuestions team={team} questions={q.data?.sharedQuestions ?? []} onAdd={setAdding} /> },
        ]
      }
    >
      <ApiErrorAlert error={actions.fix.error ?? actions.addSource.error} />
      {dismissing && t && <DismissDialog team={team} topic={t} onClose={() => setDismissing(false)} />}
      {adding && t && <GapEvaluationDialog team={team} topic={t} question={adding} onClose={() => setAdding(null)} />}
    </RecordPage>
  );
}

function topicFacts(t: GapTopic) {
  return [
    { label: "Agent", value: t.agentName },
    { label: "Questions", value: `${plural(t.questions, "question")} from ${plural(t.askers, "person", "people")} (${t.last30Days} in the last 30 days)` },
    { label: "Shared", value: plural(t.shared, "question") },
    { label: "First asked", value: <Time value={t.firstSeen} format="datetime" /> },
    { label: "Last asked", value: <Time value={t.lastSeen} format="datetime" /> },
    { label: "Last 8 weeks", value: <Sparkline className={s.trend} size="sm" values={t.trend} label={trendLabel(t.trend)} /> },
    ...(t.stateReason ? [{ label: "Reason", value: t.stateReason }] : []),
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
    addSource: useMutation({
      mutationFn: async (t: GapTopic) => {
        unwrap(await api.POST("/v1/teams/{team}/gap-topics/{topicId}/add-source", { params: { path } }));
        return t;
      },
      onSuccess: (t) => void navigate({ to: "/teams/$team/sources", params: { team }, search: { gap: topicName(t), agent: t.agentName } as never }),
    }),
  };
}

function DismissDialog({ team, topic, onClose }: { team: string; topic: GapTopic; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const dismiss = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/teams/{team}/gap-topics/{topicId}/dismiss", { params: { path: { team, topicId: topic.id } }, body: { reason: reason.trim() } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gapTopicsKey(team) });
      toast.success("Topic dismissed", "It reopens if new questions about it fail.");
      onClose();
    },
  });
  return (
    <FormDialog title="Dismiss this topic?" description={`${topicName(topic)} leaves the open topics until new questions about it fail.`} onClose={onClose}
      submitLabel="Dismiss" busy={dismiss.isPending} onSubmit={() => dismiss.mutate()}>
      <ApiErrorAlert error={dismiss.error} />
      <Field label="Reason" labelHint="Optional" description="For example, the agent isn't meant to answer this.">
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
