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

export const evalSetsKey = (team: string) => ["team", team, "evaluation-sets"];
export const evalSetKey = (team: string, setId: string) => ["team", team, "evaluation-set", setId];
export const evalQuestionsKey = (team: string, setId: string) => [...evalSetKey(team, setId), "questions"];
export const evalRunsKey = (team: string, setId: string) => [...evalSetKey(team, setId), "runs"];

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

/** The runs; refetched every 2 seconds while one is queued or running (live progress). */
export function useEvalRuns(team: string, setId: string) {
  return useQuery({
    queryKey: evalRunsKey(team, setId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/runs", { params: { path: { team, setId } } })),
    refetchInterval: (q) => (q.state.data?.some((r) => active(r)) ? 2000 : false),
  });
}

export const active = (r: Pick<EvalRun, "status">) => r.status === "queued" || r.status === "running";

export function useEvalRun(team: string, setId: string, runId: string | undefined) {
  return useQuery({
    queryKey: [...evalRunsKey(team, setId), runId],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/runs/{runId}", { params: { path: { team, setId, runId: runId! } } })),
    enabled: Boolean(runId),
    refetchInterval: (q) => (q.state.data && active(q.state.data.run) ? 2000 : false),
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

/** Documents of the set's knowledge bases matching text (the expected-documents picker). */
export function useEvalDocuments(team: string, setId: string | undefined, text: string) {
  return useQuery({
    queryKey: ["team", team, "evaluation-set", setId, "documents", text],
    queryFn: async () =>
      unwrap(await api.GET("/v1/teams/{team}/evaluation-sets/{setId}/documents", { params: { path: { team, setId: setId! }, query: { q: text, limit: 20 } } })),
    enabled: Boolean(setId),
    placeholderData: (prev) => prev,
  });
}
