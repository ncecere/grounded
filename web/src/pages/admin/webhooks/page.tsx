/*
 * Admin → Webhooks (v0.6.0, F3): the approved destinations, and the platform's own webhooks (platform events: a team was created, a team was
 * requested). Webhooks are off until a platform admin turns them on in Admin → Settings → Features; while they are off nothing new can be made
 * or sent. Platform admins manage; auditors read.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { webhookSettingsQuery } from "../../webhooks/api";
import { WebhooksPanel } from "../../webhooks/webhooks-panel";
import { useIsPlatformAdmin } from "../hooks";
import { DestinationsCard } from "./destinations";

export function AdminWebhooksPage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useQuery(webhookSettingsQuery());
  // Until the switch is read, nothing is offered: the page never invites a create it would refuse.
  const on = settings.data?.enabled === true;
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Webhooks"
        description="Send signed events to other systems. Team admins make webhooks for their team's events, to the destinations approved here; platform webhooks hear the platform's own events."
      />
      {settings.data && !on && (
        <Alert tone="info" title="Webhooks are turned off">
          No webhook can be made and nothing is sent until they are turned on in{" "}
          <TextLink render={<Link to="/admin/settings" />}>Admin → Settings → Features</TextLink>. The destinations below can be prepared meanwhile, and webhooks that exist are kept.
        </Alert>
      )}
      {!isAdmin && <Alert tone="info">Auditors can view webhooks and their deliveries. Only platform admins can change them.</Alert>}
      <DestinationsCard isAdmin={isAdmin} />
      <Card title="Platform webhooks" description="Hear the platform's events: a team was created, a team was requested. Up to 10. A platform webhook never receives a team's own events.">
        <WebhooksPanel scope={{ kind: "platform" }} canManage={isAdmin} on={on} />
      </Card>
    </Stack>
  );
}
