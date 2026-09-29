/* A SystemOne feature's state beside its title: the agents' default, how many agents use it, and the latency it added lately. */
import { StatusBadge } from "@/components/ui/badge/badge";
import so from "./systemone.module.css";

/**
 * The platform default ("Default: off") is not the whole story: agents can turn a check on for themselves, so the
 * state says how many published agents it is on for, from the saved settings.
 */
export function FeatureState({ on, latency, agents }: { on: boolean; latency?: string; agents?: number }) {
  const use = agents === undefined ? undefined : agents === 0 ? "No agent uses it" : `On for ${agents.toLocaleString()} ${agents === 1 ? "agent" : "agents"}`;
  const note = [use, latency].filter(Boolean).join(" · ");
  return (
    <span className={so.state}>
      {note && <span className={so.latency}>{note}</span>}
      <StatusBadge tone={on ? "success" : "neutral"}>{on ? "Default: on" : "Default: off"}</StatusBadge>
    </span>
  );
}

/** "Adds 180 ms (median, last 14 days)", or undefined without data. */
export function latencyNote(ms: number | null | undefined) {
  if (ms == null) return undefined;
  const v = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
  return `Adds ${v} (median, last 14 days)`;
}
