/*
 * Admin → Overview (D6, A1): the admin portal's landing page. What needs
 * attention first, the platform at a glance, a setup checklist for new
 * installs and the recent admin changes.
 */
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { terms } from "@/lib/terms";
import s from "../../shared.module.css";
import { AttentionQueue } from "./attention";
import { PlatformGlance } from "./glance";
import { KeyRotationNotice } from "./key-rotation";
import { RecentChanges } from "./recent";
import { SetupChecklist } from "./setup";
import o from "./overview.module.css";

export function AdminOverviewPage() {
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={terms.adminOverview} description="What needs a platform admin, and how the platform is doing." />
      <KeyRotationNotice />
      <SetupChecklist />
      <div className={o.columns}>
        <AttentionQueue />
        <RecentChanges />
      </div>
      <PlatformGlance />
    </Stack>
  );
}
