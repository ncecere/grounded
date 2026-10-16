/*
 * How someone without a team gets onto one (tasks H10), in the same words on Home and in the workspace switcher: the
 * in-app request page when a platform admin has turned team requests on (v0.6.0), else the platform's team request form
 * (TEAM_REQUEST_URL) or help link (SUPPORT_URL) when it has one, otherwise "ask a platform admin".
 */
import { useAuthConfig, useCurrentUser, useInstance } from "../../session";

/** An outside link (href) or the in-app request page (to). */
export type JoinTeamLink = { href: string; label: string } | { to: "/team-requests"; label: string };
export type JoinTeamHelp = { text: string; link?: JoinTeamLink };

export function joinTeamHelp(teamRequestUrl?: string | null, supportUrl?: string | null, inApp = false): JoinTeamHelp {
  const ask = "To join a team, ask one of its owners to add you";
  if (inApp) return { text: `${ask}, or request a new team.`, link: { to: "/team-requests", label: "Request a new team" } };
  if (teamRequestUrl) return { text: `${ask}, or request a new team.`, link: { href: teamRequestUrl, label: "Request a new team" } };
  if (supportUrl) return { text: `${ask}, or ask for help getting onto one.`, link: { href: supportUrl, label: "Get help" } };
  return { text: `${ask}. Not sure who? Ask a platform admin.` };
}

export function useJoinTeamHelp(): JoinTeamHelp {
  const config = useAuthConfig();
  const instance = useInstance();
  const inApp = useCurrentUser().capabilities.teamRequests === true;
  return joinTeamHelp(config.data?.teamRequestUrl, instance.supportUrl, inApp);
}
