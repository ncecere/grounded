/* Fixtures for the evaluation tests (docs/evaluations.md). */
import type { Schemas } from "../api/client";
import { type Handler, meFor, shellRoutes } from "./harness";

export const meWithEvals = (teamRole = "editor", on = true) => {
  const me = meFor("none", teamRole);
  return { ...me, capabilities: { ...me.capabilities, evaluations: on } };
};

export const kb: Schemas["KnowledgeBase"] = {
  id: "k1",
  name: "Student handbook",
  description: "",
  embeddingProfileId: "p1",
  topK: 4,
  sources: [{ id: "s1", name: "Policies", classification: "open", shared: false }],
  effectiveClassification: "open",
  revision: 2,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const summary = (extra: Partial<Schemas["EvaluationSummary"]> = {}): Schemas["EvaluationSummary"] => ({
  k: 4, questions: 3, passed: 1, failed: 1, missing: 1, notIndexed: 1, errors: 0, recall: 0.5, mrr: 0.5, cited: 0, citedOnly: 0, refused: 0, ...extra,
});

export const set: Schemas["EvaluationSet"] = {
  id: "set1",
  target: { type: "knowledge_base", id: "k1", name: "Student handbook" },
  name: "Transcript questions",
  description: "What students ask the registrar",
  autoRun: false,
  questionCount: 2,
  lastRun: { id: "r2", kind: "retrieval", status: "completed", summary: summary(), createdAt: "2026-09-27T10:00:00Z" },
  previousRun: null,
  revision: 3,
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
};

export const questions: Schemas["EvaluationQuestion"][] = [
  {
    id: "q1",
    question: "How do I order a transcript?",
    expected: { documentIds: ["d1"], urls: ["https://example.edu/registrar/transcripts*"], filenames: [] },
    expectedDocuments: [{ id: "d1", title: "Transcript policy", filename: "transcripts.pdf", url: "" }],
    mustMention: ["fee"],
    note: "From the FAQ",
    revision: 1,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-20T10:00:00Z",
  },
  {
    id: "q2",
    question: "When does registration open?",
    expected: { documentIds: [], urls: [], filenames: ["calendar.pdf"] },
    expectedDocuments: [],
    mustMention: [],
    note: "",
    revision: 1,
    createdAt: "2026-09-21T10:00:00Z",
    updatedAt: "2026-09-21T10:00:00Z",
  },
];

const config = (topK: number, profile = "Nomic 768"): Schemas["EvaluationRunConfig"] => ({
  kbs: [{ id: "k1", name: "Student handbook", profileId: "p1", profile, topK }],
  resultsPerSearch: topK,
});

export const run = (id: string, at: string, extra: Partial<Schemas["EvaluationRun"]> = {}): Schemas["EvaluationRun"] => ({
  id,
  setId: "set1",
  kind: "retrieval",
  trigger: "manual",
  status: "completed",
  startedBy: "u1",
  config: config(4),
  summary: summary(),
  total: 3,
  done: 3,
  error: "",
  createdAt: at,
  startedAt: at,
  finishedAt: at,
  ...extra,
});

export const runs: Schemas["EvaluationRun"][] = [
  run("r2", "2026-09-27T10:00:00Z", { config: config(1), summary: summary({ k: 1, recall: 0.5 }) }),
  run("r1", "2026-09-26T10:00:00Z", { summary: summary({ passed: 2, failed: 0, recall: 1, mrr: 0.75 }) }),
];

export const result = (id: string, question: string, status: Schemas["EvaluationResult"]["status"], extra: Partial<Schemas["EvaluationResult"]> = {}) => ({
  id,
  questionId: id.replace("res", "q"),
  question,
  status,
  rank: status === "pass" ? 1 : null,
  hits: [{ rank: 1, documentId: "d9", title: "Registration calendar", url: "https://example.edu/calendar", expected: status === "pass" }],
  expectedItems: [],
  missingReason: null,
  answer: null,
  scores: null,
  error: "",
  latencyMs: 12,
  ...extra,
});

type CheckBody = { expected: Schemas["EvaluationExpected"]; mustMention?: string[] };

/**
 * The question form's check: everything is in the knowledge base except
 * what `missing` names (expected values and phrases).
 */
export const checkReply =
  (missing: string[] = []): Handler =>
  (b) => {
    const { expected, mustMention = [] } = b as CheckBody;
    const item = (kind: "document" | "url" | "filename", value: string) => ({ kind, value, state: missing.includes(value) ? "not_indexed" : "indexed" });
    return {
      expected: [...expected.documentIds.map((v) => item("document", v)), ...expected.urls.map((v) => item("url", v)), ...expected.filenames.map((v) => item("filename", v))],
      mustMention: mustMention.map((phrase) => ({ phrase, found: !missing.includes(phrase) })),
    };
  };

export const evalRoutes = (teamRole = "editor", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("none", teamRole),
  "GET /v1/me": () => meWithEvals(teamRole),
  "GET /v1/teams/registrar/kbs/k1": () => kb,
  "GET /v1/teams/registrar/kbs/k1/profile-migration": () => null,
  "GET /v1/teams/registrar/sources": () => [],
  "GET /v1/shared-sources": () => [],
  "GET /v1/teams/registrar/agents": () => [],
  "GET /v1/teams/registrar/evaluation-sets": () => [set],
  "GET /v1/teams/registrar/evaluation-sets/set1": () => set,
  "GET /v1/teams/registrar/evaluation-sets/set1/questions": () => questions,
  "GET /v1/teams/registrar/evaluation-sets/set1/documents": () => [{ id: "d1", title: "Transcript policy", filename: "transcripts.pdf", url: "", sourceName: "Policies" }],
  "GET /v1/teams/registrar/evaluation-sets/set1/runs": () => runs,
  "POST /v1/teams/registrar/evaluation-question-check": checkReply(),
  ...extra,
});
