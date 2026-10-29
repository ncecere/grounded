/* Labels, badges and helpers shared by the admin users and teams pages. */
import type { Schemas } from "@/api/client";
import { StatusBadge } from "@/components/ui/badge/badge";

export const platformRoleLabels: Record<Schemas["PlatformRole"], string> = {
  none: "None",
  platform_admin: "Platform admin",
  platform_auditor: "Platform auditor",
};

export function UserStatusBadge({ status }: { status: Schemas["User"]["status"] }) {
  return status === "active" ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="danger">Suspended</StatusBadge>;
}

export function TeamStatusBadge({ status }: { status: Schemas["TeamStatus"] }) {
  return status === "active" ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="warning">Archived</StatusBadge>;
}
