/* The chat empty state: the agent, its welcome message and starter questions. No Markdown here, so the editor's preview stays light. */
import { ConversationEmptyState } from "@/components/ui/conversation/conversation";
import { MessageAvatar } from "@/components/ui/message/message";
import { Suggestion, Suggestions } from "@/components/ui/suggestion/suggestion";
import c from "./chat.module.css";

export type AgentLook = {
  name: string;
  /** "#rrggbb" or "" for the default. */
  accentColor?: string;
  welcomeMessage?: string;
  starterQuestions?: string[];
  description?: string;
};

/** The agent's tile colour: its accent (the API guarantees 4.5:1 with white text) or the brand primary. */
const agentColor = (color?: string) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : "var(--color-primary)");

/** The agent's avatar tile (initials on its accent colour). Decorative. */
export function AgentAvatar({ agent, size = "sm" }: { agent: Pick<AgentLook, "name" | "accentColor">; size?: "sm" | "md" | "lg" | "xl" }) {
  return <MessageAvatar name={agent.name} color={agentColor(agent.accentColor)} size={size} shape="square" />;
}

export function ChatWelcome({ agent, onStarter, disabled }: { agent: AgentLook; onStarter?: (q: string) => void; disabled?: boolean }) {
  const starters = (agent.starterQuestions ?? []).map((q) => q.trim()).filter(Boolean);
  return (
    <ConversationEmptyState
      className={c.welcome}
      media={<AgentAvatar agent={agent} size="xl" />}
      title={<span className={c.welcomeName}>{agent.name}</span>}
      description={<span className={c.welcomeText}>{agent.welcomeMessage || agent.description || `Ask ${agent.name} a question.`}</span>}
    >
      {starters.length > 0 && (
        <Suggestions label="Suggested questions" className={c.starters}>
          {starters.map((q) => (
            <Suggestion key={q} suggestion={q} disabled={disabled || !onStarter} onSelect={onStarter} />
          ))}
        </Suggestions>
      )}
    </ConversationEmptyState>
  );
}
