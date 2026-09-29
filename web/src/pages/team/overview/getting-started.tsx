/*
 * "Getting started" for a new team (W5): add a source → create a knowledge
 * base → create an agent → publish it. A bitop-ui Checklist whose steps tick
 * themselves off from the team's data; each open step links to the page (and
 * opens its create dialog). Editors and above can dismiss it; the choice is
 * remembered per team in this browser. It disappears once every step is done.
 * While it shows, its current step's button is the page's one primary action
 * (the Overview's header leaves its own out: checklistShowing).
 */
import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { type Intent, requestIntent } from "../../../lib/intents";
import { Checklist, type ChecklistStep } from "@/components/ui/checklist/checklist";
import { useAgents } from "../../agents/common";
import { useKBs, useSources, useTeam } from "../common";

const dismissedKey = (team: string) => `grounded.gettingStarted.dismissed.${team}`;

function readDismissed(team: string) {
  try {
    return globalThis.localStorage?.getItem(dismissedKey(team)) === "1";
  } catch {
    return false;
  }
}

/** The steps and whether they're all done (undefined while loading). */
export function useGettingStarted() {
  const { slug: team } = useTeam();
  const sources = useSources(team);
  const kbs = useKBs(team);
  const agents = useAgents(team);
  const loaded = sources.data !== undefined && kbs.data !== undefined && agents.data !== undefined;
  const list = agents.data ?? [];
  const live = list.find((a) => a.published && a.status === "active");
  const draft = list.find((a) => !a.published);
  const go = (intent?: Intent) => () => intent && requestIntent(intent);
  const steps: ChecklistStep[] = [
    {
      id: "source",
      title: "Add a data source",
      description: "Upload files or index a website. Documents are split into passages and embedded for search.",
      done: (sources.data?.length ?? 0) > 0,
      action: { label: "New data source", render: <Link to="/teams/$team/sources" params={{ team }} />, onClick: go("new-source") },
    },
    {
      id: "kb",
      title: "Create a knowledge base",
      description: "Combine data sources into one searchable collection, and try a search.",
      done: (kbs.data?.length ?? 0) > 0,
      action: { label: "New knowledge base", render: <Link to="/teams/$team/kbs" params={{ team }} />, onClick: go("new-kb") },
    },
    {
      id: "agent",
      title: "Create an agent",
      description: "Pick knowledge bases and a chat model, then test the agent's answers.",
      done: list.length > 0,
      action: { label: "New agent", render: <Link to="/teams/$team/agents" params={{ team }} />, onClick: go("new-agent") },
    },
    {
      id: "publish",
      title: "Publish it",
      description: live ? `${live.name} is live.` : "Publish the agent to your team so members can chat with it.",
      done: Boolean(live),
      action: draft ? { label: `Open ${draft.name}`, render: <Link to="/teams/$team/agents/$agentId" params={{ team, agentId: draft.id }} search={{ tab: "share" }} /> } : undefined,
    },
  ];
  return { steps, complete: loaded ? steps.every((st) => st.done) : undefined };
}

/** Whether this team's checklist was dismissed in this browser, and dismissing it; the Overview holds it for its header too. */
export function useChecklistDismissed(slug: string) {
  const [dismissed, setDismissed] = useState(() => readDismissed(slug));
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      globalThis.localStorage?.setItem(dismissedKey(slug), "1");
    } catch {
      // Storage can be unavailable; it stays hidden until the page reloads.
    }
  }, [slug]);
  return { dismissed, dismiss };
}

/** Whether the checklist shows (editors and above, not dismissed, a step left; undefined while loading). */
export function useChecklistShowing(dismissed: boolean) {
  const { canEdit } = useTeam();
  const { complete } = useGettingStarted();
  if (!canEdit || dismissed) return false;
  return complete === undefined ? undefined : !complete;
}

export function GettingStarted({ dismissed, onDismiss }: { dismissed: boolean; onDismiss: () => void }) {
  const { canEdit } = useTeam();
  const { steps, complete } = useGettingStarted();
  if (!canEdit || dismissed || complete !== false) return null;
  return <Checklist title="Getting started" description="Set up your team's first agent in four steps." steps={steps} onDismiss={onDismiss} />;
}
