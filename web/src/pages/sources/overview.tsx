/*
 * A source's facts line (header) and Overview tab (D3): the stat cards live
 * only here. The site, mode and schedule that the old "Website" card showed
 * are facts in the header now.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, FileUp, Globe, HardDrive, Layers, Library, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { api, unwrap } from "../../api/client";
import { RelativeTime } from "@/components/templates/list-page";
import { Button } from "@/components/ui/button/button";
import type { Fact } from "@/components/ui/description-list/description-list";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { TextLink } from "@/components/ui/text-link/text-link";
import { passagesCount } from "@/lib/terms";
import s from "../shared.module.css";
import { type KB, formatBytes, kbsKey, plural, profileName, useEmbeddingProfiles } from "../team/common";
import { ActiveCrawlPanel, isActiveCrawl } from "./crawls";
import { type DataSource, useSourceOwner } from "./owner";
import { describeWeb, scheduleLabels } from "./web-form";
import w from "./detail.module.css";

/** "Weekly · next sync in 4 days", "Manual only", "Weekly · no syncs while paused". */
export function scheduleFact(source: DataSource): ReactNode {
  const schedule = source.web?.schedule;
  if (!schedule) return undefined;
  if (schedule === "manual") return scheduleLabels.manual;
  if (source.status === "paused") return `${scheduleLabels[schedule]} · no syncs while paused`;
  return (
    <>
      {scheduleLabels[schedule]} · next sync {source.nextSyncAt ? <RelativeTime value={source.nextSyncAt} /> : "after the current crawl"}
    </>
  );
}

/** The team's knowledge bases that search this source (team sources only; undefined while loading). */
export function useSourceUsedBy(source: DataSource): KB[] | undefined {
  const owner = useSourceOwner();
  const team = owner.team ?? "";
  const kbs = useQuery({
    queryKey: kbsKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs", { params: { path: { team } } })),
    enabled: owner.kind === "team",
  });
  return kbs.data?.filter((kb) => kb.sources.some((src) => src.id === source.id));
}

/** The host of the first URL, e.g. "registrar.example.edu", with "+2" for more. */
function siteFact(source: DataSource): ReactNode {
  const urls = source.web?.urls ?? [];
  const first = urls[0];
  if (!first) return undefined;
  let host = first;
  try {
    host = new URL(first).host;
  } catch {
    /* keep the text */
  }
  return (
    <>
      <TextLink href={first} target="_blank" rel="noreferrer" external>
        {host}
      </TextLink>
      {urls.length > 1 && <span className={w.subtle}> and {plural(urls.length - 1, "more URL")}</span>}
    </>
  );
}

/** The header's facts: type, profile, site and schedule (web), last sync, counts. */
export function useSourceFacts(source: DataSource): Fact[] {
  const owner = useSourceOwner();
  const profiles = useEmbeddingProfiles();
  const web = source.type === "web";
  const c = source.documents;
  return [
    { id: "type", label: "Type", icon: web ? <Globe /> : <FileUp />, value: web ? "Website" : "Upload" },
    { id: "shared", value: owner.kind === "platform" ? "Shared with every team" : undefined },
    { id: "site", label: "Site", value: web ? siteFact(source) : undefined },
    { id: "mode", label: "Mode", value: web && source.web ? describeWeb(source.web) : undefined },
    { id: "schedule", label: "Schedule", value: web ? scheduleFact(source) : undefined },
    {
      id: "sync",
      label: "Last sync",
      value: web ? source.lastSyncAt ? <>Synced <RelativeTime value={source.lastSyncAt} /></> : "Not synced yet" : undefined,
    },
    { id: "profile", label: "Embedding profile", value: profileName(profiles.data, source.embeddingProfileId) },
    { id: "documents", label: web ? "Pages" : "Documents", value: plural(c.total, web ? "page" : "document") },
    { id: "passages", label: "Passages", value: passagesCount(c.chunks) },
  ];
}

/** Documents (with their status breakdown), passages, size and the knowledge bases that use the source. */
export function SourceStats({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const usedBy = useSourceUsedBy(source);
  const c = source.documents;
  const web = source.type === "web";
  const inProgress = c.pending + c.processing;
  const breakdown: [number, string][] = [
    [c.ready, "ready"],
    [inProgress, "in progress"],
    [c.failed, "failed"],
    [c.skipped, "skipped"],
  ];
  const team = owner.kind === "team";
  return (
    <section aria-label="Document counts" className={team ? s.stats : s.stats3}>
      <StatCard
        label={web ? "Pages" : "Documents"}
        value={c.total.toLocaleString()}
        icon={<FileText />}
        details={
          <ul className={w.breakdown}>
            {breakdown.map(([n, label]) => (
              <li key={label} data-tone={label === "failed" && n > 0 ? "danger" : undefined}>
                {n.toLocaleString()} {label}
              </li>
            ))}
          </ul>
        }
        hint={inProgress > 0 ? "Updating automatically" : undefined}
      />
      <StatCard label="Passages" value={c.chunks.toLocaleString()} icon={<Layers />} hint="Searchable pieces of the documents" />
      <StatCard label="Size" value={formatBytes(c.bytes)} icon={<HardDrive />} hint={web ? "Fetched pages and files" : "Original files"} />
      {team && (
        <StatCard
          label="Used by knowledge bases"
          value={usedBy === undefined ? "…" : usedBy.length.toLocaleString()}
          icon={<Library />}
          hint={usedBy && usedBy.length > 0 ? <UsedByLinks kbs={usedBy} team={owner.team!} /> : "Not in a knowledge base yet"}
        />
      )}
    </section>
  );
}

function UsedByLinks({ kbs, team }: { kbs: KB[]; team: string }) {
  return (
    <span className={w.usedBy}>
      {kbs.slice(0, 3).map((kb, i) => (
        <span key={kb.id}>
          {i > 0 && ", "}
          <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team, kbId: kb.id }} />}>{kb.name}</TextLink>
        </span>
      ))}
      {kbs.length > 3 && ` and ${kbs.length - 3} more`}
    </span>
  );
}

/**
 * The Overview tab: the running crawl, the counts, then source-level blocks.
 * `onUpload` opens the upload sheet (editors of upload sources).
 */
export function SourceOverview({ source, onUpload, extra }: { source: DataSource; onUpload?: () => void; extra?: ReactNode }) {
  const active = isActiveCrawl(source.activeCrawl) ? source.activeCrawl : null;
  const empty = source.documents.total === 0;
  return (
    <>
      {active && <ActiveCrawlPanel source={source} crawl={active} />}
      <SourceStats source={source} />
      {/* Source-level blocks go after the stats, e.g. "Repeated blocks removed" (boilerplate suppression). */}
      {extra}
      {empty && source.type === "upload" && (
        <EmptyState
          icon={<Upload />}
          title="No documents yet."
          description="Upload PDF, Word, PowerPoint, HTML, Markdown or text files. They're split into passages that knowledge bases search."
          action={
            onUpload && (
              <Button variant="secondary" onClick={onUpload}>
                <Upload aria-hidden /> Upload files
              </Button>
            )
          }
        />
      )}
    </>
  );
}
