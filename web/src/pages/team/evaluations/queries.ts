/* Evaluation sets (docs/evaluations.md): types, query keys and queries shared by the tabs, the set page and "Add to evaluations". */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";
import { useCurrentUser } from "@/session";

export type EvalSet = Schemas["EvaluationSet"];
export type EvalQuestion = Schemas["EvaluationQuestion"];
export type EvalRun = Schemas["EvaluationRun"];
export type EvalResult = Schemas["EvaluationResult"];
export type EvalSummary = Schemas["EvaluationSummary"];
export type EvalDocument = Schemas["EvaluationDocument"];
export type EvalExpected = Schemas["EvaluationExpected"];
export type EvalExpectedItem = Schemas["EvaluationExpectedItem"];
export type EvalQuestionCheck = Schemas["EvaluationQuestionCheck"];
export type EvalProblem = Schemas["EvaluationQuestionProblem"];

export const evalSetsKey = (team: string) => ["team", team, "evaluation-sets"];
export const evalSetKey = (team: string, setId: string) => ["team", team, "evaluation-set", setId];
export const evalQuestionsKey = (team: string, setId: string) => [...evalSetKey(team, setId), "questions"];
export const evalRunsKey = (team: string, setId: string) => [...evalSetKey(team, setId), "runs"];
/** Under the set's key: whatever refreshes the set (a question saved or deleted, a run started) checks again. */
export const evalProblemsKey = (team: string, setId: string) => [...evalSetKey(team, setId), "problems"];

/** Evaluations are on for the platform (from /v1/me). */
export function useEvaluationsOn() {
  return useCurrentUser().capabilities.evaluations === true;
}

/** Whether the signed-in person may add questions for a team's agents: evaluations are on and they're an editor or above there. */
export function useCanAddToEvaluations(teamSlug: string | undefined) {
  const me = useCurrentUser();
  const role = me.teams.find((t) => t.slug === teamSlug)?.role;
  return me.capabilities.evaluations === true && (role === "editor" || role === "admin" || role === "owner");
}

/** A team's sets, optionally one knowledge base's or agent's. */
export const evalSetsQuery = (team: string, filter: { kbId?: string; agentId?: string } = {}) =>
  queryOptions({
    queryKey: [...evalSetsKey(team), filter],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets", { params: { path: { team }, query: filter } })),
  });

export const evalSetQuery = (team: string, setId: string) =>
  queryOptions({
    queryKey: evalSetKey(team, setId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}", { params: { path: { team, setId } } })),
  });

export const evalQuestionsQuery = (team: string, setId: string) =>
  queryOptions({
    queryKey: evalQuestionsKey(team, setId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/questions", { params: { path: { team, setId } } })),
  });

/** The questions that need attention, checked by the server each time it's asked (when the set's page opens). */
export const evalProblemsQuery = (team: string, setId: string) =>
  queryOptions({
    queryKey: evalProblemsKey(team, setId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/problems", { params: { path: { team, setId } } })),
  });

/**
 * The runs; refetched every 2 seconds while one is queued or running (live
 * progress), also while the tab is in the background, so a finished run
 * shows as Completed without a reload.
 */
export function useEvalRuns(team: string, setId: string) {
  return useQuery({
    queryKey: evalRunsKey(team, setId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/runs", { params: { path: { team, setId } } })),
    refetchInterval: (q) => (q.state.data?.some((r) => active(r)) ? 2000 : false),
    refetchIntervalInBackground: true,
  });
}

export const active = (r: Pick<EvalRun, "status">) => r.status === "queued" || r.status === "running";

export function useEvalRun(team: string, setId: string, runId: string | undefined) {
  return useQuery({
    queryKey: [...evalRunsKey(team, setId), runId],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/runs/{runId}", { params: { path: { team, setId, runId: runId! } } })),
    enabled: Boolean(runId),
    refetchInterval: (q) => (q.state.data && active(q.state.data.run) ? 2000 : false),
    refetchIntervalInBackground: true,
  });
}

export function useEvalQuestion(team: string, setId: string, id: string | undefined) {
  return useQuery({
    queryKey: [...evalQuestionsKey(team, setId), id],
    queryFn: async () =>
      unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/questions/{questionId}", { params: { path: { team, setId, questionId: id! } } })),
    enabled: Boolean(id),
  });
}

export function useEvalComparison(team: string, setId: string, a: string | undefined, b: string | undefined) {
  return useQuery({
    queryKey: [...evalRunsKey(team, setId), "compare", a, b],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/runs/compare", { params: { path: { team, setId }, query: { a: a!, b: b! } } })),
    enabled: Boolean(a && b),
  });
}

/** Where the expected-documents picker searches: a set's knowledge bases, or, before the set exists, its knowledge base's or agent's. */
export type DocumentScope = { setId: string } | { kbId: string } | { agentId: string };

/** Documents matching text (the expected-documents picker). */
export function useEvalDocuments(team: string, scope: DocumentScope | undefined, text: string) {
  return useQuery({
    queryKey: ["team", team, "evaluation-documents", scope, text],
    queryFn: async () => {
      if (scope && "setId" in scope)
        return unwrap(
          await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/documents", { params: { path: { team, setId: scope.setId }, query: { q: text, limit: 20 } } }),
        );
      return unwrap(await api.GET("/v1/teams/{team}/evaluation-documents", { params: { path: { team }, query: { ...scope, q: text, limit: 20 } } }));
    },
    enabled: Boolean(scope),
    placeholderData: (prev) => prev,
  });
}

/** What the question form checks: where the question's set searches, and what it expects. */
export type QuestionCheckInput = { expected: EvalExpected; mustMention: string[] };

/**
 * Whether the knowledge bases hold a question's expected documents and
 * must-mention phrases (the form's warnings; nothing is saved). Only asked
 * once there's something to check.
 */
export function useQuestionCheck(team: string, scope: DocumentScope | undefined, input: QuestionCheckInput) {
  const count = input.expected.documentIds.length + input.expected.urls.length + input.expected.filenames.length + input.mustMention.length;
  return useQuery({
    queryKey: ["team", team, "evaluation-question-check", scope, input],
    queryFn: async () => unwrap(await api.POST("/v1/teams/{team}/evaluation-question-check", { params: { path: { team } }, body: { ...scope, ...input } })),
    enabled: Boolean(scope) && count > 0,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: 30_000,
  });
}
