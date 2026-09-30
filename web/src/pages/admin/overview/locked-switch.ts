/*
 * A Features switch the viewer can't change (auditors). It stays in the tab
 * order, read-only and announced as disabled (aria-disabled), so keyboard
 * users reach it and hear its reason (its description); a disabled switch
 * would be skipped (WCAG 2.1.1).
 */
import o from "./overview.module.css";

export const lockedReason = "Only platform admins can turn this on or off.";

export function lockedSwitch(isAdmin: boolean) {
  return isAdmin ? {} : { readOnly: true, "aria-disabled": true, className: o.lockedSwitch, description: lockedReason };
}
