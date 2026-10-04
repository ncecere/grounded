/*
 * Admin Overview › Set up this install (A1): connection → chat model →
 * embedding profile → classification approvals → public moderation → first
 * team. Shown until every step is done or an admin dismisses it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Checklist, type ChecklistStep } from "@/components/ui/checklist/checklist";
import { useCurrentUser } from "@/session";
import { useClassificationLevels } from "../../team/common";
import { featuresQuery } from "./queries";

const DISMISS_KEY = "grounded.admin.setup-dismissed";

type Inputs = {
  connections: number;
  chatModels: { maxClassification: string }[];
  defaultProfile: boolean;
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
      done: x.defaultProfile,
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
  // From the Overview's one features request (AD-03), not six of its own.
  const features = useQuery(featuresQuery(useQueryClient()));
  const levels = useClassificationLevels();
  if (dismissed || !features.data || !levels.data) return null;
  const setup = features.data.setup;
  const steps = setupSteps({
    connections: setup.connections,
    chatModels: setup.chatModelClassifications.map((maxClassification) => ({ maxClassification })),
    defaultProfile: setup.defaultProfile,
    levels: levels.data,
    publicModeration: features.data.publicModeration,
    teams: setup.teams,
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
