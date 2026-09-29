/*
 * Admin → Overview (D6, A1; reordered in v0.2.1, I2): the admin portal's
 * landing page. The platform at a glance first, then what needs attention
 * beside the optional features (with the evaluations switch), a setup
 * checklist for new installs and the last 5 admin changes.
 */
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { terms } from "@/lib/terms";
import s from "../../shared.module.css";
import { AttentionQueue } from "./attention";
import { FeaturesCard } from "./features";
import { PlatformGlance } from "./glance";
import { KeyRotationNotice } from "./key-rotation";
import { RecentChanges } from "./recent";
import { SetupChecklist } from "./setup";
import o from "./overview.module.css";

export function AdminOverviewPage() {
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={terms.adminOverview} description="How the platform is doing, what needs a platform admin, and which optional features are on." />
      <KeyRotationNotice />
      <SetupChecklist />
      <PlatformGlance />
      <div className={o.columns}>
        <AttentionQueue />
        <FeaturesCard />
      </div>
      <RecentChanges />
    </Stack>
  );
}
