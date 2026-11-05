/* Audit actions of SCIM provisioning (docs/specs/scim/DESIGN.md, "Audit"). */
export const scimActionLabels: Record<string, string> = {
  "scim.user_create": "SCIM created a user",
  "scim.user_link": "SCIM linked an existing user",
  "scim.user_update": "SCIM updated a user",
  "scim.user_suspend": "SCIM suspended a user",
  "scim.user_reactivate": "SCIM reactivated a user",
  "scim.user_unlink": "SCIM removed a user (suspended and unlinked)",
  "scim.suspend_denied": "SCIM was refused suspending the last platform admin",
  "scim.group_create": "SCIM created a group",
  "scim.group_update": "SCIM changed a group",
  "scim.group_delete": "SCIM deleted a group",
  "platform.scim_token_create": "Created a SCIM token",
  "platform.scim_token_revoke": "Revoked a SCIM token",
  "auth.scim_link": "First sign-in linked to a SCIM account",
};
