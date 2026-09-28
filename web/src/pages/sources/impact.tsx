import { Link } from "@tanstack/react-router";
import { ApiError } from "../../api/client";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Stack } from "@/components/ui/layout/layout";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { type Classification, ClassificationBadge, plural, rankOf } from "../team/common";
import { type ClassificationImpact } from "./owner";
import w from "./web.module.css";

/** Whether the change lowers the classification (needs admin + reason). */
export function isLowering(levels: Classification[], from: string, to: string) {
  const a = rankOf(levels, from);
  const b = rankOf(levels, to);
  return a !== undefined && b !== undefined && b < a;
}

/** Thrown when a classification preview finds knowledge bases that block the change. */
export class ImpactError extends Error {
  constructor(readonly impact: ClassificationImpact) {
    super("The classification change affects knowledge bases.");
  }
}

export function impactOf(err: unknown): ClassificationImpact | null {
  if (err instanceof ImpactError) return err.impact;
  if (err instanceof ApiError && err.code === "classification_impact" && err.details) return err.details as unknown as ClassificationImpact;
  return null;
}

/** "2 knowledge bases and 1 agent". */
export function impactSummary(impact: ClassificationImpact) {
  const parts = [];
  if (impact.affected.length) parts.push(plural(impact.affected.length, "knowledge base"));
  if (impact.agents?.length) parts.push(plural(impact.agents.length, "published agent"));
  return parts.join(" and ") || "Nothing";
}

/** What the blocking agents need, naming only the reasons that apply (F-19). */
export function agentFix(agents: ClassificationImpact["agents"]) {
  const model = agents.some((a) => a.reasons.includes("model"));
  const audience = agents.some((a) => a.reasons.includes("audience"));
  if (model && audience) return "those agents need a chat model approved for the level, or a narrower audience, and must be published again";
  if (audience) return "those agents must be published to an audience allowed for the level";
  return "those agents need a chat model approved for the level (then publish again)";
}

type ImpactedAgent = ClassificationImpact["agents"][number];

const fallbackReason = (a: ImpactedAgent, level: string, reason: "model" | "audience") =>
  reason === "model"
    ? `Its chat model, ${a.modelName}, is approved only up to ${a.modelMaxClassification}.`
    : `Its audience (${a.audience === "team" ? "the team" : a.audience}) isn't allowed for ${level} data.`;

/** An agent's reasons as sentences: the API's reasonText, else built from the codes (F-19). */
export const agentReasons = (a: ImpactedAgent, level: string) => a.reasons.map((r, i) => a.reasonText?.[i] || fallbackReason(a, level, r));

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The dialog's explanation (F-19, P-18): what breaks, then the reasons that
 * apply. One agent: its own reasons; several: the fix that covers them, with
 * each agent's reasons in the table. Every sentence starts with a capital.
 */
export function impactDescription(impact: ClassificationImpact, level: string) {
  const agents = impact.agents ?? [];
  const out = [`${capitalize(impactSummary(impact))} would break at ${level}.`];
  if (impact.affected.length) out.push(`${impact.affected.length === 1 ? "That knowledge base" : "Those knowledge bases"} must detach this source first.`);
  if (agents.length === 1) out.push(`${agents[0]!.agentName}: ${agentReasons(agents[0]!, level).join(" ")} Change that and publish the agent again.`);
  else if (agents.length > 1) out.push(`${capitalize(agentFix(agents))}. Each agent's reasons are in the table.`);
  return out.join(" ");
}

/**
 * Explains what blocks a classification change (ADR-0006 rule 6): knowledge
 * bases of teams approved below the level (shared sources) and published
 * agents whose chat model or audience isn't allowed for it.
 */
export function ClassificationImpactDialog({
  impact,
  levels,
  onClose,
  title,
  description,
  teamLinks,
}: {
  impact: ClassificationImpact;
  levels: Classification[];
  onClose: () => void;
  title?: string;
  description?: string;
  /** Link agents to the team's agent editor (team pages) instead of the admin team page. */
  teamLinks?: boolean;
}) {
  const name = (key: string) => levels.find((l) => l.key === key)?.name ?? key;
  const level = name(impact.classification);
  const agents = impact.agents ?? [];
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={title ?? `Can't raise the classification to ${level} yet`}
      description={description ?? impactDescription(impact, level)}
      footer={<DialogClose>Close</DialogClose>}
    >
      <Stack gap={5}>
        {impact.affected.length > 0 && (
          <Table caption="Affected knowledge bases" showCaption columns={["Team", "Knowledge base", "Team approved up to"]} maxHeight="16rem" stickyHeader>
            {impact.affected.map((a) => (
              <Tr key={a.knowledgeBaseId}>
                <Td>
                  <TextLink render={<Link to="/admin/teams/$team" params={{ team: a.teamSlug }} />}>{a.teamName}</TextLink>
                </Td>
                <Td>{a.knowledgeBaseName}</Td>
                <Td>
                  <ClassificationBadge levels={levels} value={a.teamMaxClassification} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        {agents.length > 0 && (
          <Table caption="Published agents that block the change" showCaption columns={["Agent", "Team", "Why"]} maxHeight="16rem" stickyHeader>
            {agents.map((a) => (
              <Tr key={a.agentId}>
                <Td>
                  {teamLinks ? (
                    <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team: a.teamSlug, agentId: a.agentId }} />}>{a.agentName}</TextLink>
                  ) : (
                    a.agentName
                  )}
                </Td>
                <Td>{teamLinks ? a.teamName : <TextLink render={<Link to="/admin/teams/$team" params={{ team: a.teamSlug }} />}>{a.teamName}</TextLink>}</Td>
                <Td>
                  <ul className={w.reasons}>
                    {agentReasons(a, level).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Stack>
    </Dialog>
  );
}
