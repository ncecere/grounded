/* A SystemOne feature's state beside its title: On/Off and the latency it added lately. */
import { StatusBadge } from "@/components/ui/badge/badge";
import so from "./systemone.module.css";

export function FeatureState({ on, latency }: { on: boolean; latency?: string }) {
  return (
    <span className={so.state}>
      {latency && <span className={so.latency}>{latency}</span>}
      <StatusBadge tone={on ? "success" : "neutral"}>{on ? "On" : "Off"}</StatusBadge>
    </span>
  );
}

/** "Adds 180 ms (median, last 14 days)", or undefined without data. */
export function latencyNote(ms: number | null | undefined) {
  if (ms == null) return undefined;
  const v = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
  return `Adds ${v} (median, last 14 days)`;
}
