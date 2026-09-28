/*
 * Admin Overview › Set up this install (A1): connection → chat model →
 * embedding profile → classification approvals → public moderation → first
 * team. Shown until every step is done or an admin dismisses it.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Checklist, type ChecklistStep } from "@/components/ui/checklist/checklist";
import { useCurrentUser } from "@/session";
import { useClassificationLevels } from "../../team/common";
import { useConnections, useModels } from "../models/common";
import { profilesQuery, publicPolicyQuery } from "./queries";

const DISMISS_KEY = "grounded.admin.setup-dismissed";

type Inputs = {
  connections: number;
  chatModels: { maxClassification: string }[];
  profiles: { status: string; isDefault: boolean }[];
  levels: { key: string; rank: number; name: string }[];
  publicModeration: boolean;
  teams: number;
};

/** The setup steps and whether each is done (pure, unit-tested). */
export function setupSteps(x: Inputs): ChecklistStep[] {
  const rank = new Map(x.levels.map((l) => [l.key, l.rank]));
  const top = Math.max(...x.chatModels.map((m) => rank.get(m.maxClassification) ?? -1), -1);
  const uncovered = x.levels.filter((l) => l.rank > top);
  return [
    {
      id: "connection",
      title: "Connect a model provider",
      description: "An OpenAI-compatible endpoint, such as your AI gateway.",
      done: x.connections > 0,
      action: { label: "Add connection", render: <Link to="/admin/connections" /> },
    },
    {
      id: "models",
      title: "Add a chat model",
      description: "Agents answer with an enabled chat model.",
      done: x.chatModels.length > 0,
      action: { label: "Add model", render: <Link to="/admin/models" /> },
    },
    {
      id: "profile",
      title: "Choose a default embedding profile",
      description: "Sources index their documents with it.",
      done: x.profiles.some((p) => p.isDefault && p.status === "active"),
      action: { label: "Embedding profiles", render: <Link to="/admin/embedding-profiles" /> },
    },
    {
      id: "classifications",
      title: "Approve models for each classification",
      description: uncovered.length ? `No enabled chat model may process ${uncovered.map((l) => l.name).join(", ")} data yet.` : "Every level has a chat model.",
      done: x.chatModels.length > 0 && uncovered.length === 0,
      action: { label: "Review models", render: <Link to="/admin/models" /> },
    },
    {
      id: "moderation",
      title: "Choose a moderation provider for public agents",
      description: "Required before any agent can be public.",
      done: x.publicModeration,
      action: { label: "Moderation", render: <Link to="/admin/moderation" search={{ tab: "public" }} /> },
    },
    {
      id: "team",
      title: "Create the first team",
      description: "Teams build sources, knowledge bases and agents.",
      done: x.teams > 0,
      action: { label: "Create team", render: <Link to="/admin/teams" /> },
    },
  ];
}

/** Only for platform admins: auditors can't act on the steps (read-only). */
export function SetupChecklist() {
  const { capabilities } = useCurrentUser();
  if (!capabilities.platformAdmin) return null;
  return <AdminSetupChecklist />;
}

function AdminSetupChecklist() {
  const [dismissed, setDismissed] = useState(() => globalThis.localStorage?.getItem(DISMISS_KEY) === "1");
  const connections = useConnections();
  const models = useModels();
  const profiles = useQuery(profilesQuery());
  const levels = useClassificationLevels();
  const policy = useQuery(publicPolicyQuery());
  const teams = useQuery({ queryKey: ["admin", "teams", "any"], queryFn: async () => unwrap(await api.GET("/v1/admin/teams", { params: { query: { limit: 1 } } })) });
  const loading = [connections, models, profiles, levels, policy, teams].some((q) => q.isLoading);
  if (dismissed || loading) return null;
  const steps = setupSteps({
    connections: connections.data?.length ?? 0,
    chatModels: (models.data ?? []).filter((m) => m.kind === "chat" && m.enabled),
    profiles: profiles.data ?? [],
    levels: levels.data ?? [],
    publicModeration: Boolean(policy.data?.modelId),
    teams: teams.data?.items.length ?? 0,
  });
  if (steps.every((s) => s.done)) return null;
  return (
    <Checklist
      title="Set up this install"
      description="The steps a new install needs before teams can build agents."
      steps={steps}
      onDismiss={() => {
        globalThis.localStorage?.setItem(DISMISS_KEY, "1");
        setDismissed(true);
      }}
    />
  );
}
