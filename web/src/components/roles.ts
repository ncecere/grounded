import { type Schemas } from "../api/client";

export type TeamRole = Schemas["TeamRole"];

export const teamRoles: TeamRole[] = ["owner", "admin", "editor", "member"];

export const roleLabels: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", member: "Member" };

/** Mirrors the server rule: owners manage everyone; admins manage non-owners. */
export function canManage(actorRole: TeamRole | undefined, targetRole: TeamRole | "", newRole?: TeamRole) {
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return targetRole !== "owner" && newRole !== "owner";
}

/**
 * What each team role can and can't do, for the role explanation (DESIGN.md §3.5, the server's rules in internal/authz).
 * Short on purpose: the most asked-about abilities.
 */
export const roleAbilities: Record<TeamRole, { can: string[]; cannot: string[] }> = {
  owner: {
    can: ["Everything an admin can", "Add and remove other owners"],
    cannot: ["Change the team's limits, budget or approved classification (platform admins do)"],
  },
  admin: {
    can: [
      "Everything an editor can",
      "Manage members (not owners)",
      "Create team service keys",
      "Publish agents to all signed-in users or the public",
      "Lower a source's classification",
    ],
    cannot: ["Manage owners", "Change the team's limits or budget"],
  },
  editor: {
    can: [
      "Chat with the team's agents and search its knowledge bases",
      "Create and edit data sources, knowledge bases, agents and evaluations",
      "Publish agents to the team",
      "Request crawl domains",
      "Read the team's usage and audit log",
    ],
    cannot: ["Manage members or team service keys", "Publish agents beyond the team", "Lower a source's classification"],
  },
  member: {
    can: ["Chat with the team's agents and search its knowledge bases", "Create personal API keys for queries"],
    cannot: ["Change data sources, knowledge bases or agents", "See the team's usage or audit log"],
  },
};
