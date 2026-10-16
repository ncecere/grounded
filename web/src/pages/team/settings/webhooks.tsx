/*
 * Team settings › Webhooks (v0.6.0, F3): where a team's admins and owners send the team's events (a source synced, an agent was published,
 * feedback was given) to another system. The tab shows only for them, and only while a platform admin has webhooks on (the `webhooks`
 * capability); the notifications about a paused webhook link to ?tab=webhooks.
 */
import { Card } from "@/components/ui/card/card";
import { WebhooksPanel } from "../../webhooks/webhooks-panel";
import { useTeam } from "../common";

export function WebhooksTab() {
  const { slug } = useTeam();
  return (
    <Card
      title="Webhooks"
      description="Send this team's events (a source synced, an agent was published, feedback was given) to another system as signed HTTPS requests. Up to 10 webhooks, to destinations a platform admin approved."
    >
      <WebhooksPanel scope={{ kind: "team", team: slug }} canManage on />
    </Card>
  );
}
