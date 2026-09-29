/*
 * Admin → SSO groups (E1; route /admin/group-mapping): rules that give people in an identity-provider
 * group a role in a team, applied at every sign-in. Above the list, what the
 * sign-ins carry: the claim read and how many people had it, with a warning
 * when rules exist but no sign-in carries the claim.
 */
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert/alert";
import { RelativeTime } from "@/components/templates/list-page";
import { terms } from "@/lib/terms";
import { useIsPlatformAdmin } from "../hooks";
import { groupMappingStatusQuery } from "./queries";
import { RuleList } from "./rules";
import g from "./group-mapping.module.css";

function StatusNotices() {
  const status = useQuery(groupMappingStatusQuery());
  const st = status.data;
  if (!st) return null;
  const claim = <code>{st.groupsClaim}</code>;
  return (
    <>
      {!st.oidcEnabled && (
        <Alert tone="warning" title="Single sign-on isn't configured">
          Rules apply at OIDC sign-in. Development sign-in uses the groups in DEV_AUTH_GROUPS.
        </Alert>
      )}
      {st.ruleCount > 0 && st.recentSignIns > 0 && st.recentWithClaim === 0 && (
        <Alert tone="warning" title={<>No recent sign-in carried the {claim} claim</>}>
          The rules add nobody, and remove the memberships they created at each sign-in. Make the identity provider send the claim, or set OIDC_GROUPS_CLAIM.
        </Alert>
      )}
      <p className={g.facts}>
        <span>Claim read at sign-in: {claim}</span>
        <span>
          People whose last sign-in carried it: {st.peopleWithClaim.toLocaleString()} of {st.peopleSeen.toLocaleString()}
        </span>
        <span>
          Last seen: <RelativeTime value={st.lastClaimAt} />
        </span>
      </p>
    </>
  );
}

export function GroupMappingPage() {
  const isAdmin = useIsPlatformAdmin();
  return (
    <RuleList
      isAdmin={isAdmin}
      title={terms.groupMapping}
      description="People in an identity-provider group get a role in a team when they sign in, and lose it when they leave the group. Members added by hand are never changed."
      notices={<StatusNotices />}
    />
  );
}
