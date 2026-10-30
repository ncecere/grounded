/* The content health report (docs/content-health.md): types, queries and the words for signals, states and reasons. */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";

export type Report = Schemas["ContentHealthReport"];
export type ReportList = Schemas["ContentHealthReportList"];
export type ReportDetail = Schemas["ContentHealthReportDetail"];
export type Signal = Schemas["ContentHealthSignal"];
export type SignalName = Schemas["ContentHealthSignalName"];
export type Finding = Schemas["ContentHealthFinding"];
export type Coverage = Schemas["ContentHealthSourceCoverage"];

export const healthKey = (team: string) => ["team", team, "content-health"];
export const reportKey = (team: string, id: string) => [...healthKey(team), "report", id];
export const findingsKey = (team: string, id: string, signal: string) => [...reportKey(team, id), "findings", signal];

/** Reports in progress are read again every few seconds until they end. */
export const activeStatus = (status?: Report["status"]) => status === "queued" || status === "running";
export const POLL_MS = 3000;

export const reportsQuery = (team: string) =>
  queryOptions({
    queryKey: healthKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/content-health/reports", { params: { path: { team } } })),
    refetchInterval: (q) => (q.state.data?.reports.some((r) => activeStatus(r.status)) ? POLL_MS : false),
  });

export const reportQuery = (team: string, reportId: string) =>
  queryOptions({
    queryKey: reportKey(team, reportId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/content-health/reports/{reportId}", { params: { path: { team, reportId } } })),
    refetchInterval: (q) => (activeStatus(q.state.data?.report.status) ? POLL_MS : false),
  });

export const FINDINGS_PAGE = 25;

export const findingsQuery = (team: string, reportId: string, signal: SignalName, cursor: string | undefined) =>
  queryOptions({
    queryKey: [...findingsKey(team, reportId, signal), cursor ?? ""],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/teams/{team}/content-health/reports/{reportId}/findings", {
          params: { path: { team, reportId }, query: { signal, cursor, limit: FINDINGS_PAGE } },
        }),
      ),
  });

export type SignalWords = { title: string; measures: string; notMeans: string; empty: string };

/** What each signal counts and what it does not mean, in the words the page shows (docs/content-health.md, "The signals"). */
export const signalWords: Record<SignalName, SignalWords> = {
  stale: {
    title: "Not processed in a long time",
    measures: "Ready documents whose last successful processing was at least the chosen number of days before the report began.",
    notMeans:
      "This is when Grounded last finished processing the document (a new or changed file, a retry, a re-read after an upgrade), not when someone last edited it, which Grounded doesn't know. An old page can be perfectly current.",
    empty: "No document is older than the threshold.",
  },
  broken_link: {
    title: "Links that failed in the last crawl",
    measures: "Addresses the latest completed crawl of a web source tried to fetch and could not: not found, a server error, or a network error.",
    notMeans:
      "These were seen failing once, when that crawl ended, and are not checked again. Grounded doesn't record which page links to them. Nothing is fetched to make this list. A source with no usable crawl record is shown as unknown, not as having no broken links.",
    empty: "The crawls that were read recorded no failed address.",
  },
  duplicate: {
    title: "The same file in two sources",
    measures: "Groups of ready documents in different sources of this team with byte-for-byte identical content (the same SHA-256 of the original file).",
    notMeans:
      "Only identical files match: the same text as a PDF and a Word file, a page with a changing timestamp, or near-duplicates are not found. Other teams' and shared platform sources are never compared.",
    empty: "No file appears in two sources.",
  },
  never_cited: {
    title: "No retained citation evidence",
    measures:
      "Ready documents of sources a published agent reaches, for which the kept answer records show no citation in the team-wide window. Only documents that existed when their source became reachable are judged, and only when enough answers were kept since.",
    notMeans:
      "It does not mean a document is unused, outdated or poor, and it is not a claim that the document had a fair chance of being cited: Grounded does not record which documents a question could have reached. The window is team-wide and starts at the team's first kept answer, not when any document became reachable. Answers that were never kept, or that the analytics retention period removed, are invisible; deleting a conversation does not remove its record. Draft test chats, refusals, errors and answers with no passages are not counted. A document can be rarely cited simply because few people ask about it.",
    empty: "Every document that could be judged has a citation in the kept answers.",
  },
  ingestion_failure: {
    title: "Failed to parse or ingest",
    measures: "Documents that failed, that need OCR, or that have not finished ingesting after a day.",
    notMeans: "Only the error code is shown; open the document for the details. A document that read with warnings is not listed.",
    empty: "No document failed.",
  },
};

export const signalOrder: SignalName[] = ["stale", "broken_link", "duplicate", "never_cited", "ingestion_failure"];

/** Why a signal could not be measured or does not apply, in words. */
export const reasonText: Record<string, string> = {
  no_sources: "There are no sources in this scope.",
  no_documents: "There are no ready documents in this scope.",
  one_source: "Needs at least two sources in the scope.",
  no_web_sources: "There is no web source in this scope.",
  no_crawl_record: "No web source has a usable crawl record.",
  no_answers: "No answers are kept for this team's agents in the window.",
  too_few_answers: "Too few kept answers that could have cited something, team-wide, to say which documents have no citation evidence.",
  too_many_answers: "More answers than a report reads. Try a shorter window: a narrower scope does not reduce what is read.",
  too_many_agents: "This team has more agents than a report reads answers for, so it cannot say which documents have no citation evidence.",
  no_exposure: "No source could be judged: no published agent reaches it through a knowledge base, too few answers were kept since it became reachable, or its documents were added later.",
  timed_out: "It took longer than a report may take.",
};

export const stateLabel: Record<Signal["state"], string> = { measured: "Measured", not_applicable: "Not applicable", unavailable: "Unavailable" };
export const stateTone: Record<Signal["state"], "success" | "neutral" | "warning"> = { measured: "success", not_applicable: "neutral", unavailable: "warning" };

export const statusLabel: Record<Report["status"], string> = {
  queued: "Waiting to start",
  running: "Being made",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const failureText: Record<string, string> = {
  internal: "The report couldn't be made. Try again; if it keeps failing, ask a platform admin to check the logs.",
  timed_out: "The report took too long and was stopped. Try a smaller scope (one source or one knowledge base).",
  too_many_sources: "This team has more sources than one report covers. Choose one source or one knowledge base.",
  disabled: "Content health reports were switched off before this one started.",
};

export const linkCodeLabel: Record<string, string> = { not_found: "Not found (404 or 410)", http_error: "Server error or refused", network_error: "Couldn't connect" };
export const failureClassLabel: Record<string, string> = {
  needs_ocr: "Needs OCR",
  ocr_error: "OCR failed",
  damaged: "Damaged, protected or unsupported",
  other: "Failed",
  not_finished: "Not finished after a day",
};

export const linkStateText = (c: Pick<Coverage, "linkState" | "linkReason" | "linkFailed" | "linkTruncated">): string => {
  if (c.linkState === "not_applicable") return "Not applicable (not a web source)";
  if (c.linkState === "observed") return `Observed: ${c.linkFailed.toLocaleString()} failed${c.linkTruncated ? "; that crawl stopped at a limit" : ""}`;
  const why: Record<string, string> = {
    never_crawled: "never crawled",
    page_refetch_latest: "the latest crawl was a single-page re-fetch, which discards the earlier record",
    no_crawl_record: "the crawl's record is gone",
    signal_timed_out: "reading the crawl records took too long",
  };
  return `Unknown: ${why[c.linkReason] ?? "no usable crawl record"}`;
};

/** Whether a source's failed addresses are still shown, when they are not. */
export const linkRefsText: Record<string, string> = {
  source_changed: "Its addresses are hidden: the source was changed after the crawl was read.",
  crawl_changed: "Its addresses are hidden: a newer crawl has replaced that observation.",
};

/** What the not-cited signal could say about a source. */
export const citeStateText = (c: Pick<Coverage, "citeState" | "exposedSince" | "exposureAnswers">, minAnswers: number): string => {
  switch (c.citeState) {
    case "judged":
      return `Judged: ${c.exposureAnswers.toLocaleString()} kept answers could have cited it since it became reachable`;
    case "too_few_answers":
      return `Not judged: ${c.exposureAnswers.toLocaleString()} kept answers since it became reachable, fewer than ${minAnswers}`;
    case "not_served":
      return "Not judged: no published agent reaches it through a knowledge base";
    default:
      return "Not measured";
  }
};
