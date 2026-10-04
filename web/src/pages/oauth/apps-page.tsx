/*
 * Connected apps (/settings/connected-apps), from the account menu: the
 * person's OAuth connections, reachable for everyone, including people in
 * no team (who have no API keys page) and platform admins and auditors.
 */
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import s from "../shared.module.css";
import { ConnectedApps } from "./connected-apps";

export function ConnectedAppsPage() {
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title="Connected apps" description="AI tools you connected to your account. They can search and ask as you in each of your teams." />
      {/* The page is already "Connected apps": the card says whose they are (VI-18), and doesn't say again what they are (US-14). */}
      <ConnectedApps owner={{ self: true }} canDisconnect title="Your apps" description="Disconnecting one stops it at once." />
    </Stack>
  );
}
