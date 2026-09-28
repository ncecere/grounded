/* Crawl runs of a web source: Sync now, the live progress panel, and the history table. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCheck, Download, History, RefreshCw, Search, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, limitError, type Schemas } from "../../api/client";
import { formatDate } from "../../lib/format";
import { type MaintenanceStatus, maintenanceReason, useMaintenance } from "../../lib/maintenance";
import { RelativeTime } from "@/components/templates/list-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Progress } from "@/components/ui/progress/progress";
import { Loading } from "@/components/ui/spinner/spinner";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import type { Tone } from "@/lib/bitop-utils";
import s from "../shared.module.css";
import { plural } from "../team/common";
import { type Crawl, type DataSource, type SourceOwner, useSourceOwner } from "./owner";
import w from "./crawls.module.css";

type CrawlStatus = Schemas["CrawlStatus"];

export const crawlStatusLabels: Record<CrawlStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const crawlStatusTones: Record<CrawlStatus, Tone> = { queued: "neutral", running: "info", completed: "success", failed: "danger", cancelled: "warning" };
const triggerLabels: Record<Crawl["trigger"], string> = { create: "Source created", manual: "Manual", schedule: "Scheduled", page: "One page re-fetched" };

const truncatedHelp = "The crawl reached its page limit, so pages it didn't reach were kept. No pages are removed after a truncated crawl.";

const truncatedHelps: Record<NonNullable<Crawl["truncatedReason"]>, string> = {
  max_pages: truncatedHelp,
  documents_limit:
    "The crawl stopped because your team reached its documents limit. Pages it didn't store were kept as they were, and no pages were removed. Delete documents or ask a platform admin to raise the limit.",
  storage_limit:
    "The crawl stopped because your team reached its storage limit. Pages it didn't store were kept as they were, and no pages were removed. Delete documents or ask a platform admin to raise the limit.",
};

/** Why a crawl stopped early. */
const truncatedHelpFor = (c: Crawl) => truncatedHelps[c.truncatedReason ?? "max_pages"];

const truncatedLabels: Record<NonNullable<Crawl["truncatedReason"]>, string> = {
  max_pages: "Truncated",
  documents_limit: "Stopped: documents limit",
  storage_limit: "Stopped: storage limit",
};

/** Why an active crawl is waiting, or undefined when it isn't. */
function waitingText(c: Crawl): string | undefined {
  switch (c.waitingReason) {
    case "concurrent_crawls":
      return "Waiting for a free crawl slot. Your team has reached its limit of crawls running at once; this crawl starts when another finishes.";
    case "daily_page_limit":
      return `Paused: your team has crawled its daily page limit. The crawl continues after midnight UTC${c.waitingUntil ? ` (${formatDate(c.waitingUntil)})` : ""}, or as soon as a platform admin raises the limit.`;
    case "maintenance":
      return "Paused for maintenance after its last page. The crawl continues by itself when maintenance ends.";
    case "monthly_budget":
      return `Waiting: the team's monthly budget is used up. The crawl continues when the budget resets${c.waitingUntil ? ` (${formatDate(c.waitingUntil)})` : ""}, or as soon as a platform admin raises it or grants an extension.`;
    default:
      return undefined;
  }
}

/** The waiting alert's title and the history's short line, per reason. */
const waitingLabels: Record<NonNullable<Crawl["waitingReason"]>, { title: string; short: string }> = {
  concurrent_crawls: { title: "Waiting for a crawl slot", short: "Waiting for a crawl slot" },
  daily_page_limit: { title: "Daily page limit reached", short: "Waiting for tomorrow's page limit" },
  maintenance: { title: "Paused for maintenance", short: "Paused for maintenance" },
  monthly_budget: { title: "Monthly budget used up", short: "Waiting for the monthly budget" },
};

export const isActiveCrawl = (c?: Crawl | null): c is Crawl => !!c && (c.status === "queued" || c.status === "running");

function CrawlStatusBadge({ status }: { status: CrawlStatus }) {
  return (
    <StatusBadge tone={crawlStatusTones[status]} pulse={status === "running"}>
      {crawlStatusLabels[status]}
    </StatusBadge>
  );
}

/** "45 s", "3 min 5 s", "1 h 2 min"; "—" before the crawl starts. */
export function formatDuration(startedAt: string | null | undefined, finishedAt: string | null | undefined, now = Date.now()) {
  if (!startedAt) return "—";
  const ms = (finishedAt ? Date.parse(finishedAt) : now) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${sec % 60 ? ` ${sec % 60} s` : ""}`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Puts a crawl into the cached source as its active crawl (or clears it when it has ended). */
function setActiveCrawl(qc: ReturnType<typeof useQueryClient>, owner: SourceOwner, sourceId: string, crawl: Crawl | null) {
  qc.setQueryData<DataSource>(owner.keys.source(sourceId), (old) => old && { ...old, activeCrawl: isActiveCrawl(crawl) ? crawl : null });
}

function invalidateSource(qc: ReturnType<typeof useQueryClient>, owner: SourceOwner, sourceId: string) {
  // The source key prefixes its documents and crawls.
  qc.invalidateQueries({ queryKey: owner.keys.source(sourceId) });
  qc.invalidateQueries({ queryKey: owner.keys.list });
}

/** Why Sync now is unavailable, or undefined when it's available. */
export function syncBlockedReason(source: DataSource, maintenance?: MaintenanceStatus | null) {
  if (source.status === "paused") return "Activate this source to sync it.";
  if (isActiveCrawl(source.activeCrawl)) return "A crawl is running. You can sync again when it finishes.";
  if (maintenance) return maintenanceReason(maintenance, "Syncing");
  return undefined;
}

/**
 * Sync now: editors and above. Disabled while paused or crawling; the page
 * shows the reason in the element with id `reasonId`.
 */
export function SyncButton({ source, reasonId }: { source: DataSource; reasonId?: string }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => owner.api.sync(source.id),
    onSuccess: (crawl) => {
      setActiveCrawl(qc, owner, source.id, crawl);
      toast.success("Sync started", "The crawl's progress is shown on this page.");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "crawl_in_progress") {
        const crawl = err.details?.crawl as Crawl | undefined;
        if (crawl) setActiveCrawl(qc, owner, source.id, crawl);
        toast.info("A crawl is already running", "Its progress is shown on this page.");
      } else if (limitError(err)) {
        const l = limitError(err)!;
        toast.error(l.title, l.message);
      } else {
        toast.error("Couldn't start a sync", errorMessage(err));
      }
    },
    onSettled: () => invalidateSource(qc, owner, source.id),
  });
  const maintenance = useMaintenance(owner.canEdit);
  if (!owner.canEdit) return null;
  const reason = syncBlockedReason(source, maintenance);
  return (
    <Button loading={sync.isPending} disabled={!!reason} aria-describedby={reason ? reasonId : undefined} onClick={() => sync.mutate()}>
      <RefreshCw aria-hidden /> Sync now
    </Button>
  );
}

/**
 * A coarse progress sentence for the live region: it changes when the status
 * changes or another tenth of the page limit is fetched, so screen readers
 * aren't flooded every two seconds.
 */
export function crawlAnnouncement(crawl: Crawl, maxPages: number) {
  const waiting = waitingText(crawl);
  if (waiting) return waiting;
  if (crawl.status === "queued") return "Crawl queued. It starts when a crawler is free.";
  if (crawl.status !== "running") return `Crawl ${crawlStatusLabels[crawl.status].toLowerCase()}.`;
  const step = Math.max(1, Math.ceil(maxPages / 10));
  const rounded = Math.floor(crawl.pagesFetched / step) * step;
  return `Crawl running: ${rounded === 0 ? "starting" : `at least ${plural(rounded, "page")} fetched`} of up to ${plural(maxPages, "page")}.`;
}

/** The queued or running crawl: live counts, progress against the page limit, and Cancel. */
export function ActiveCrawlPanel({ source, crawl }: { source: DataSource; crawl: Crawl }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const maxPages = Math.max(source.web?.maxPages ?? 0, crawl.pagesFetched, 1);
  const queued = crawl.status === "queued";
  const waiting = waitingText(crawl);
  const cancel = useMutation({
    mutationFn: () => owner.api.cancelCrawl(source.id, crawl.id),
    onSuccess: (c) => {
      setConfirming(false);
      setActiveCrawl(qc, owner, source.id, c);
      toast.info("Crawl cancelled", "Pages fetched so far are kept.");
    },
    onSettled: () => invalidateSource(qc, owner, source.id),
  });
  const n = (v: number) => v.toLocaleString();

  return (
    <Card
      title={waiting ? "Crawl waiting" : queued ? "Crawl queued" : "Crawl in progress"}
      description={`${triggerLabels[crawl.trigger]} · ${crawl.startedAt ? `started ${formatDate(crawl.startedAt)}` : `queued ${formatDate(crawl.createdAt)}`}. Updates every 2 seconds.`}
      actions={
        owner.canEdit && (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Cancel crawl
          </Button>
        )
      }
    >
      <div className={w.crawlBody}>
        {waiting && (
          <Alert tone="warning" title={waitingLabels[crawl.waitingReason ?? "concurrent_crawls"].title}>
            {waiting}
          </Alert>
        )}
        <div className={w.crawlMeta}>
          <CrawlStatusBadge status={crawl.status} />
          <span>
            {n(crawl.pagesFetched)} of up to {plural(maxPages, "page")} fetched
            {crawl.pagesDiscovered > 0 && ` · ${n(crawl.pagesDiscovered)} discovered`}
          </span>
        </div>
        <Progress label="Pages fetched, of the page limit" value={queued ? null : Math.min(crawl.pagesFetched, maxPages)} max={maxPages} />
        <p role="status" className="sr-only">
          {crawlAnnouncement(crawl, maxPages)}
        </p>
        <section aria-label="Crawl counts" className={w.crawlStats}>
          <StatCard label="Fetched" value={`${n(crawl.pagesFetched)} / ${n(maxPages)}`} icon={<Download />} />
          <StatCard label="Changed" value={n(crawl.pagesChanged)} icon={<RefreshCw />} hint="New or updated" />
          <StatCard label="Unchanged" value={n(crawl.pagesUnchanged)} icon={<CheckCheck />} />
          <StatCard label="Skipped" value={n(crawl.pagesSkipped)} icon={<SkipForward />} hint="Robots, scope, type" />
          <StatCard label="Failed" value={n(crawl.pagesFailed)} icon={<AlertCircle />} />
          <StatCard label="Discovered" value={n(crawl.pagesDiscovered)} icon={<Search />} />
        </section>
      </div>
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) cancel.reset();
        }}
        title="Cancel this crawl?"
        description="The crawler stops before its next page. Pages fetched so far are kept, and no pages are removed from the source."
        confirmLabel="Cancel crawl"
        cancelLabel="Keep crawling"
        busy={cancel.isPending}
        error={cancel.error}
        onConfirm={() => cancel.mutate()}
      />
    </Card>
  );
}

/** Refreshes the source's documents and history when its active crawl ends. */
export function useCrawlFinished(source: DataSource | undefined) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  const activeId = isActiveCrawl(source?.activeCrawl) ? source.activeCrawl.id : null;
  useEffect(() => {
    if (last.current && !activeId && source) {
      qc.invalidateQueries({ queryKey: owner.keys.crawls(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.documents(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.list });
      toast.info("Crawl finished", "The crawl history has the details.");
    }
    last.current = activeId;
  }, [activeId, owner, qc, source]);
}

function TruncatedBadge({ crawl }: { crawl: Crawl }) {
  const label = truncatedLabels[crawl.truncatedReason ?? "max_pages"];
  const help = truncatedHelpFor(crawl);
  return (
    <Tooltip content={help}>
      <button type="button" className={w.badgeButton} aria-label={`${label}: ${help}`}>
        <Badge tone="warning" variant="outline">
          {label}
        </Badge>
      </button>
    </Tooltip>
  );
}

export function CrawlHistory({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const active = isActiveCrawl(source.activeCrawl);
  const crawls = useQuery({
    queryKey: owner.keys.crawls(source.id),
    queryFn: () => owner.api.crawls(source.id),
    refetchInterval: active ? 2000 : false,
  });
  const list = crawls.data ?? [];
  if (crawls.isLoading) return <Loading label="Loading crawl history…" />;
  if (crawls.error)
    return (
      <div className={s.pad}>
        <ErrorAlert error={crawls.error} />
      </div>
    );
  if (list.length === 0) return <EmptyState size="compact" icon={<History />} title="No crawls yet." />;
  const anyTruncated = list.some((c) => c.truncated && (c.truncatedReason ?? "max_pages") === "max_pages");
  return (
    <>
      <Table
        caption="Crawl history"
        columns={[
          "Status",
          "Trigger",
          "Started",
          { label: "Duration", numeric: true },
          { label: "Fetched", numeric: true },
          { label: "Changed", numeric: true },
          { label: "Failed", numeric: true },
          { label: "Deleted", numeric: true },
        ]}
      >
        {list.map((c) => (
          <Tr key={c.id}>
            <Td>
              <span className={w.cellStack}>
                <CrawlStatusBadge status={c.status} />
                {c.truncated && <TruncatedBadge crawl={c} />}
              </span>
              {c.error && <span className={s.dangerText}>{c.error}</span>}
              {isActiveCrawl(c) && waitingText(c) && (
                <span className={s.secondary}>{waitingLabels[c.waitingReason ?? "concurrent_crawls"].short}</span>
              )}
            </Td>
            <Td muted>{triggerLabels[c.trigger]}</Td>
            <Td muted nowrap>
              <RelativeTime value={c.startedAt ?? c.createdAt} />
            </Td>
            <Td numeric>{formatDuration(c.startedAt, c.finishedAt)}</Td>
            <Td numeric>{c.pagesFetched.toLocaleString()}</Td>
            <Td numeric>{c.pagesChanged.toLocaleString()}</Td>
            <Td numeric>{c.pagesFailed.toLocaleString()}</Td>
            <Td numeric>{c.documentsDeleted.toLocaleString()}</Td>
          </Tr>
        ))}
      </Table>
      {anyTruncated && <p className={w.footnote}>Truncated: {truncatedHelp}</p>}
    </>
  );
}
