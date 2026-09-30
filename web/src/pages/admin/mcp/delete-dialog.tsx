/*
 * Deleting an MCP server. Deleting is refused while a published agent
 * version uses one of its tools (409 mcp_server_in_use, details.agents), so
 * the dialog checks the tools' usedBy first and, when blocked, names those
 * agents and their versions instead of offering Delete (docs/mcp-client.md).
 */
import type { UseMutationResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiError } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { TextLink } from "@/components/ui/text-link/text-link";
import { type MCPServer, type MCPToolUse, useMCPTools } from "./common";
import t from "./mcp.module.css";

/** The agents that use a tool or a server, each linked to its record. */
export function AgentUses({ uses, label }: { uses: MCPToolUse[]; label: string }) {
  return (
    <ul className={t.uses} aria-label={label}>
      {uses.map((u) => (
        <li key={u.agentId}>
          <TextLink render={<Link to="/admin/agents" search={{ record: u.agentId } as never} />}>{u.agentName}</TextLink> ({u.teamName}), version{" "}
          {u.version}
        </li>
      ))}
    </ul>
  );
}

/** The distinct agents using any of the tools. */
export function serverUses(tools: { usedBy?: MCPToolUse[] }[] | undefined): MCPToolUse[] {
  const seen = new Map<string, MCPToolUse>();
  for (const x of tools ?? []) for (const u of x.usedBy ?? []) seen.set(u.agentId, u);
  return [...seen.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));
}

/** The agents named by a 409 mcp_server_in_use. */
function refusedUses(err: unknown): MCPToolUse[] | undefined {
  if (!(err instanceof ApiError) || err.code !== "mcp_server_in_use") return undefined;
  const agents = (err.details?.agents ?? []) as { id: string; name: string; teamSlug: string; teamName: string; version: number }[];
  return agents.map((a) => ({ agentId: a.id, agentName: a.name, teamSlug: a.teamSlug, teamName: a.teamName, version: a.version }));
}

type Props = {
  target: MCPServer | null;
  onClose: () => void;
  mutation: UseMutationResult<unknown, Error, MCPServer>;
};

export function DeleteServerDialog({ target, onClose, mutation }: Props) {
  const tools = useMCPTools(target?.id);
  const known = serverUses(tools.data);
  // Wait for the tools, so a blocked delete never offers Delete first.
  if (target && tools.isLoading) return null;
  const uses = refusedUses(mutation.error) ?? known;
  if (target && uses.length > 0) {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) {
            onClose();
            mutation.reset();
          }
        }}
        title={`${target.name} can't be deleted`}
        description="Published agents use its tools. Disable the server instead, or publish these agents without its tools first."
        footer={<DialogClose variant="primary">Close</DialogClose>}
        size="sm"
      >
        <AgentUses uses={uses} label={`Agents that use ${target.name}`} />
      </Dialog>
    );
  }
  return (
    <ConfirmMutationDialog
      target={target}
      onClose={onClose}
      mutation={mutation}
      onConfirm={(x) => mutation.mutate(x)}
      title={`Delete ${target?.name}?`}
      description="Its tools are removed from every agent draft and past version."
      confirmLabel="Delete"
    />
  );
}
