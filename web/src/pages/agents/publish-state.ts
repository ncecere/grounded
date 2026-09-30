/*
 * Honest status (Q5): what the header says about the draft, and why Publish
 * is unavailable when it is. Pure: tested in src/test/agent-build.test.tsx.
 */
import { audienceLabel } from "@/lib/terms";
import type { Agent } from "./common";

type DraftStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export type SaveView = { text: string; tone: "muted" | "success" | "warning" | "danger"; busy?: boolean };

/** The save state shown next to the title. Never "Draft saved" while a field holds text that can't be saved (F-26). */
export function saveView(status: DraftStatus, needsFix: boolean): SaveView {
  if (status === "saving") return { text: "Saving…", tone: "muted", busy: true };
  if (status === "conflict") return { text: "Not saved: changed elsewhere", tone: "warning" };
  if (status === "error") return { text: "Couldn't save", tone: "danger" };
  if (needsFix) return { text: "Not saved: fix the highlighted field", tone: "warning" };
  if (status === "dirty") return { text: "Unsaved changes", tone: "muted" };
  return { text: "Draft saved", tone: "success" };
}

type PublishInput = {
  agent: Pick<Agent, "published" | "hasUnpublishedChanges">;
  status: DraftStatus;
  needsFix: boolean;
  /** The draft's audience (it is published with the next version). */
  audience: Agent["audience"];
  /** Team admins and owners may publish beyond the team; editors only to it (P-03). */
  isManager: boolean;
  /** The draft's publish problems (the server's draft.* warnings): publishing would refuse them. */
  problems?: number;
};

/** Why Publish is disabled, or undefined when it can be offered. */
export function publishBlocked({ agent, status, needsFix, audience, isManager, problems = 0 }: PublishInput): string | undefined {
  if (!isManager && audience !== "team")
    return `Only team admins and owners can publish to ${audienceLabel(audience)}. Choose Team under Share, or ask an admin to publish.`;
  if (problems > 0) return problems === 1 ? "Fix the problem listed under Build first." : `Fix the ${problems} problems listed under Build first.`;
  const pending = status !== "saved" || needsFix;
  if (agent.published && !agent.hasUnpublishedChanges && !pending) return `No changes since version ${agent.published.version}`;
  return undefined;
}

/** Who can chat once published, for the publish dialog (F-15). */
export const publishAudienceText: Record<Agent["audience"], string> = {
  team: "Members of this team will chat with this configuration.",
  all_authenticated: "Anyone who can sign in, from any team, will chat with this configuration. It's listed in the agent directory.",
  public: "Anyone, without signing in, will chat with this configuration: on its public page and in the widget on allowed sites.",
};
