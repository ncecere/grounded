/* The Target cell of an audit entry: its name, linked when it still exists and the viewer can open it. */
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { Schemas } from "../../api/client";
import s from "../../pages/shared.module.css";
import { TextLink } from "@/components/ui/text-link/text-link";
import { targetTypeLabel } from "./labels";

type AuditEntry = Schemas["AuditEntry"];

/** Where the log is shown. On a team's log, `member` is false for platform staff, who can't open the team's pages. */
export type AuditScope = { kind: "team"; team: string; member?: boolean } | { kind: "platform" };

function teamLink(team: string, e: AuditEntry): ReactElement | null {
  const id = e.targetId;
  switch (e.targetType) {
    case "team":
      return <Link to="/teams/$team" params={{ team }} />;
    case "data_source":
      return <Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: id }} />;
    case "document": {
      const sourceId = typeof e.metadata.sourceId === "string" ? e.metadata.sourceId : undefined;
      return sourceId ? <Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId }} search={{ tab: "documents" }} /> : null;
    }
    case "knowledge_base":
      return <Link to="/teams/$team/kbs/$kbId" params={{ team, kbId: id }} />;
    case "agent":
      return <Link to="/teams/$team/agents/$agentId" params={{ team, agentId: id }} />;
    case "api_key":
      return <Link to="/teams/$team/settings" params={{ team }} search={{ tab: "api-keys" }} />;
    case "publishable_key":
      // A widget key lives on its agent's Share tab.
      return e.parent?.exists ? <Link to="/teams/$team/agents/$agentId" params={{ team, agentId: e.parent.id }} search={{ tab: "share" }} /> : null;
    case "crawl_domain_request":
      return <Link to="/teams/$team/settings" params={{ team }} search={{ tab: "crawl-domains" }} />;
    default:
      return null;
  }
}

function platformLink(e: AuditEntry): ReactElement | null {
  const id = e.targetId;
  switch (e.targetType) {
    case "team":
      return <Link to="/admin/teams/$team" params={{ team: id }} />;
    case "user":
      return <Link to="/admin/users/$userId" params={{ userId: id }} />;
    case "data_source":
      // Only shared (platform) sources have an admin page; team sources are private to members.
      return e.teamId ? null : <Link to="/admin/shared-sources/$sourceId" params={{ sourceId: id }} />;
    case "model":
      return <Link to="/admin/models" search={{ record: id } as never} />;
    case "model_connection":
      return <Link to="/admin/connections" search={{ record: id } as never} />;
    case "embedding_profile":
      return <Link to="/admin/embedding-profiles" search={{ record: id } as never} />;
    case "classification":
      return <Link to="/admin/classifications" />;
    case "crawl_allowlist":
    case "crawl_domain_request":
      return <Link to="/admin/crawl-domains" />;
    case "agent":
      return <Link to="/admin/agents" search={{ record: id } as never} />;
    case "publishable_key":
      // A widget key's agent.
      return e.parent?.exists ? <Link to="/admin/agents" search={{ record: e.parent.id } as never} /> : <Link to="/admin/agents" />;
    case "platform_settings":
      return <Link to="/admin/public-access" />;
    case "systemone_settings":
      return <Link to="/admin/systemone" />;
    case "maintenance_mode":
      return <Link to="/admin/maintenance" />;
    case "legal_hold":
      return <Link to="/admin/legal-holds" search={{ tab: "all", record: id } as never} />;
    case "retention":
      // A retention run.
      return /^\d+$/.test(id) ? <Link to="/admin/retention" search={{ tab: "runs", record: Number(id) } as never} /> : <Link to="/admin/retention" search={{ tab: "runs" }} />;
    case "retention_settings":
      return <Link to="/admin/retention" />;
    case "break_glass_session":
      return <Link to="/admin/break-glass" search={{ record: id } as never} />;
    case "break_glass_settings":
      return <Link to="/admin/break-glass" search={{ tab: "settings" }} />;
    case "platform_limits":
      return <Link to="/admin/limits" />;
    case "moderation_policy":
      return <Link to="/admin/moderation" search={{ tab: id === "team" ? undefined : (id as "public" | "all_authenticated") }} />;
    default:
      return null;
  }
}

export function AuditTarget({ entry, scope }: { entry: AuditEntry; scope: AuditScope }) {
  const type = targetTypeLabel(entry.targetType);
  const name = entry.targetLabel;
  const link = entry.targetExists ? (scope.kind === "team" ? (scope.member === false ? null : teamLink(scope.team, entry)) : platformLink(entry)) : null;
  if (!name) {
    return (
      <>
        <span>{type}</span>
        {entry.targetId && <span className={`${s.secondary} ${s.mono}`}>{entry.targetId}</span>}
      </>
    );
  }
  return (
    <>
      {link ? (
        <TextLink render={link} className={s.primary}>
          {name}
        </TextLink>
      ) : (
        <span className={s.primary}>{name}</span>
      )}
      <span className={s.secondary}>
        {type}
        {!entry.targetExists && " (deleted)"}
      </span>
    </>
  );
}
