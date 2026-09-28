/*
 * The team's counts at a glance (W5, Q10): data sources, knowledge bases,
 * agents and documents ready. Each card is a link to the page it counts.
 */
import { Link } from "@tanstack/react-router";
import { Bot, Database, FileCheck2, Library } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import s from "../../shared.module.css";
import { useAgents } from "../../agents/common";
import { plural, useKBs, useSources, useTeam } from "../common";

type Loadable = { isLoading: boolean; error: unknown };
const show = (q: Loadable, v: number | undefined) => (q.isLoading ? "…" : q.error || v === undefined ? "—" : v.toLocaleString());

export function QuickCounts() {
  const { slug } = useTeam();
  const sources = useSources(slug);
  const kbs = useKBs(slug);
  const agents = useAgents(slug);
  const docs = (sources.data ?? []).reduce((acc, src) => ({ total: acc.total + src.documents.total, ready: acc.ready + src.documents.ready }), { total: 0, ready: 0 });
  const failing = (sources.data ?? []).filter((src) => src.documents.failed > 0).length;
  const live = (agents.data ?? []).filter((a) => a.published && a.status === "active").length;
  const usedKBs = new Set((agents.data ?? []).flatMap((a) => a.draft.kbs.map((k) => k.kbId)));
  const kbsInUse = (kbs.data ?? []).filter((kb) => usedKBs.has(kb.id)).length;
  const toSources = <Link to="/teams/$team/sources" params={{ team: slug }} />;
  return (
    <section aria-label="At a glance" className={s.stats}>
      <StatCard
        label="Data sources"
        value={show(sources, sources.data?.length)}
        icon={<Database />}
        hint={sources.error ? "Couldn't load sources" : failing > 0 ? `${plural(failing, "source")} with failed documents` : undefined}
        render={toSources}
      />
      <StatCard
        label="Knowledge bases"
        value={show(kbs, kbs.data?.length)}
        icon={<Library />}
        hint={kbs.error ? "Couldn't load knowledge bases" : kbs.data?.length && agents.data ? `${kbsInUse.toLocaleString()} used by agents` : undefined}
        render={<Link to="/teams/$team/kbs" params={{ team: slug }} />}
      />
      <StatCard
        label="Agents"
        value={show(agents, agents.data?.length)}
        icon={<Bot />}
        hint={agents.error ? "Couldn't load agents" : agents.data?.length ? `${live.toLocaleString()} live` : undefined}
        render={<Link to="/teams/$team/agents" params={{ team: slug }} />}
      />
      <StatCard
        label="Documents ready"
        value={show(sources, docs.ready)}
        icon={<FileCheck2 />}
        hint={sources.data ? `of ${plural(docs.total, "document")}` : undefined}
        render={toSources}
      />
    </section>
  );
}
