/* Share → Routers: whether routers may send questions to this agent (docs/specs/v0.6.0/DESIGN.md §4). */
import { Card } from "@/components/ui/card/card";
import { Switch } from "@/components/ui/switch/switch";
import type { AgentDraft } from "../draft";

export function RoutersCard({ d }: { d: AgentDraft }) {
  const c = d.draft.config;
  return (
    <Card title="Routers" description="A router is a front door: it sends each question to the best agent for it. Part of the draft, so a change takes effect when you publish.">
      <div id="agent-field-routable">
        <Switch
          label="Can be reached through routers"
          description="A router may send people's questions to this agent, and show its answers. It only ever sends someone to an agent they could chat with themselves, whoever made the router."
          checked={c.routable ?? false}
          onCheckedChange={(v) => d.setConfig({ routable: v })}
        />
      </div>
    </Card>
  );
}
