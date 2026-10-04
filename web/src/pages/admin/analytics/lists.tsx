/* Admin analytics tables: tokens by model (from the usage ledger), and the top agents and teams by answers. */
import { Link } from "@tanstack/react-router";
import type { Schemas } from "@/api/client";
import { num, pct } from "@/components/analytics/format";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";

const kindLabels: Record<string, string> = { chat: "Chat", embedding: "Embedding", rerank: "Rerank", moderation: "Moderation", systemone: "SystemOne", vision: "Vision (OCR)" };

export function ModelTokens({ models, audienceFiltered }: { models: Schemas["PlatformAnalyticsModel"][]; audienceFiltered?: boolean }) {
  return (
    <Card
      title="Tokens by model"
      description={
        audienceFiltered
          ? "From the usage ledger, which doesn't record the audience: every audience's tokens, including draft tests and document ingestion."
          : "From the usage ledger: every model's tokens, as Costs counts them (chat, embedding, SystemOne, rerank and OCR), including draft tests and document ingestion."
      }
      flush
    >
      {models.length === 0 ? (
        <EmptyState size="compact" title="No token use in this range." />
      ) : (
        <Table
          caption="Token use per model"
          columns={["Model", "Kind", { label: "Chat input", numeric: true }, { label: "Chat output", numeric: true }, { label: "Embedding", numeric: true }, { label: "Other", numeric: true }]}
        >
          {models.map((m) => (
            <Tr key={m.modelId}>
              <Td>{m.modelName || <span className={s.muted}>Deleted model</span>}</Td>
              <Td>{kindLabels[m.kind] ?? (m.kind || "—")}</Td>
              <Td numeric>{num(m.chatInputTokens)}</Td>
              <Td numeric>{num(m.chatOutputTokens)}</Td>
              <Td numeric>{num(m.embeddingTokens)}</Td>
              <Td numeric>{num(m.otherTokens)}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function TeamLink({ slug, name }: { slug: string; name: string }) {
  if (!slug) return <span className={s.muted}>Deleted team</span>;
  return <TextLink render={<Link to="/admin/teams/$team" params={{ team: slug }} />}>{name}</TextLink>;
}

export function TopAgents({ agents }: { agents: Schemas["PlatformAnalyticsAgent"][] }) {
  return (
    <Card title="Top agents" description="By answers in this range. Cited: the share of checked citations their source supports (SystemOne citation checks)." flush>
      {agents.length === 0 ? (
        <EmptyState size="compact" title="No answers yet." />
      ) : (
        <Table caption="Agents with the most answers" columns={["Agent", "Team", { label: "Answers", numeric: true }, { label: "No context", numeric: true }, { label: "Satisfaction", numeric: true }, { label: "Cited", numeric: true }]}>
          {agents.map((ag) => (
            <Tr key={ag.agentId}>
              <Td>
                {ag.agentName && ag.teamSlug ? (
                  <TextLink render={<Link to="/admin/agents" search={{ record: ag.agentId } as never} />}>{ag.agentName}</TextLink>
                ) : (
                  <span className={s.muted}>{ag.agentName || "Deleted agent"}</span>
                )}{" "}
                {ag.deleted && ag.agentName && <Badge tone="neutral">Deleted</Badge>}
              </Td>
              <Td>
                <TeamLink slug={ag.teamSlug} name={ag.teamName} />
              </Td>
              <Td numeric>{num(ag.answers)}</Td>
              <Td numeric>{pct(ag.noContextRate)}</Td>
              <Td numeric>{pct(ag.satisfaction)}</Td>
              <Td numeric>{pct(ag.citationSupportRate)}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export function TopTeams({ teams }: { teams: Schemas["PlatformAnalyticsTeam"][] }) {
  return (
    <Card title="Top teams" description="By answers in this range." flush>
      {teams.length === 0 ? (
        <EmptyState size="compact" title="No answers yet." />
      ) : (
        <Table caption="Teams with the most answers" columns={["Team", { label: "Answers", numeric: true }, { label: "Agents", numeric: true }]}>
          {teams.map((t) => (
            <Tr key={t.teamId}>
              <Td>
                <TeamLink slug={t.teamSlug} name={t.teamName} />
              </Td>
              <Td numeric>{num(t.answers)}</Td>
              <Td numeric>{num(t.agents)}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
