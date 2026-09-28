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
