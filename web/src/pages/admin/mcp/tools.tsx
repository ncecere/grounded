/*
 * An MCP server's tools with their approval. A tool's description and input
 * schema come from the server and the model reads them, so both are shown
 * in full before a platform admin approves the tool. Read tools fetches the
 * list again: a changed description or schema, or a tool the server no
 * longer lists, loses its approval. Withdrawing the approval of a tool that
 * published agents use asks first and names them (usedBy).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CodeBlock } from "@/components/ui/code-block/code-block";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Loading } from "@/components/ui/spinner/spinner";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { type MCPServer, type MCPTool, toolsKey, useMCPTools } from "./common";
import { AgentUses } from "./delete-dialog";
import t from "./mcp.module.css";

type Props = { server: MCPServer; isAdmin: boolean; onChanged: () => void };

export function ToolList({ server, isAdmin, onChanged }: Props) {
  const qc = useQueryClient();
  const tools = useMCPTools(server.id);
  const refresh = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/mcp-servers/{serverId}/refresh", { params: { path: { serverId: server.id } } })),
    onSuccess: (r) => {
      qc.setQueryData(toolsKey(server.id), r.tools);
      onChanged();
      const lost = r.changed + r.gone;
      toast.success(`Read ${r.listed} tools${r.added ? `, ${r.added} new` : ""}${lost ? `, ${lost} changed or gone` : ""}`);
    },
  });
  return (
    <div className={t.tools}>
      {isAdmin ? (
        <Alert tone="warning" title="Read before you approve.">
          Tool descriptions and input schemas come from the server, and the model reads them as instructions. Approve only tools you trust, and read them
          again when they change.
        </Alert>
      ) : (
        <p className={s.muted}>Tool descriptions and input schemas come from the server, and the model reads them as instructions.</p>
      )}
      {isAdmin && (
        <div>
          <Button size="sm" variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw aria-hidden /> Read tools
          </Button>
        </div>
      )}
      <ErrorAlert error={refresh.error ?? tools.error} />
      {tools.isLoading ? (
        <Loading label="Loading tools…" block={false} />
      ) : (tools.data ?? []).length === 0 ? (
        <p className={s.muted}>No tools read yet.</p>
      ) : (
        <ul className={t.toolList} aria-label={`Tools of ${server.name}`}>
          {(tools.data ?? []).map((tool) => (
            <ToolRow key={tool.id} server={server} tool={tool} isAdmin={isAdmin} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolState({ tool }: { tool: MCPTool }) {
  if (tool.goneAt) return <StatusBadge tone="neutral">No longer listed</StatusBadge>;
  return tool.approved ? <StatusBadge tone="success">Approved</StatusBadge> : <StatusBadge tone="warning">Not approved</StatusBadge>;
}

function ToolRow({ server, tool, isAdmin, onChanged }: { server: MCPServer; tool: MCPTool; isAdmin: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const approve = useMutation({
    mutationFn: async (approved: boolean) =>
      unwrap(
        await api.PUT("/v1/admin/mcp-servers/{serverId}/tools/{toolId}/approval", {
          params: { path: { serverId: server.id, toolId: tool.id } },
          body: { approved },
        }),
      ),
    onSuccess: (updated) => {
      setConfirming(false);
      // The approval reply doesn't carry usedBy: keep the listed one.
      qc.setQueryData<MCPTool[]>(toolsKey(server.id), (list) => list?.map((x) => (x.id === updated.id ? { ...updated, usedBy: x.usedBy } : x)));
      onChanged();
      toast.success(updated.approved ? `${tool.name} approved` : `${tool.name} is no longer approved`);
    },
  });
  const label = tool.title ? `${tool.title} (${tool.name})` : tool.name;
  const uses = tool.usedBy ?? [];
  const withdraw = () => (uses.length > 0 ? setConfirming(true) : approve.mutate(false));
  return (
    <li className={t.tool} aria-label={label}>
      <div className={t.toolHead}>
        <span className={t.toolName}>
          <code className={s.mono}>{tool.name}</code>
          {tool.title && <span className={s.muted}>{tool.title}</span>}
        </span>
        <ToolState tool={tool} />
      </div>
      <p className={t.description}>{tool.description || <span className={s.muted}>No description.</span>}</p>
      <Disclosure title={<>Input schema <VisuallyHidden>of {tool.name}</VisuallyHidden></>}>
        <CodeBlock code={JSON.stringify(tool.inputSchema, null, 2)} language="json" />
      </Disclosure>
      {uses.length > 0 && (
        <div className={t.usedBy}>
          <span className={s.muted}>Used by published agents:</span>
          <AgentUses uses={uses} label={`Agents that use ${tool.name}`} />
        </div>
      )}
      {!confirming && <ErrorAlert error={approve.error} />}
      {isAdmin && !tool.goneAt && (
        <div>
          {tool.approved ? (
            <Button size="sm" variant="ghost" loading={approve.isPending} onClick={withdraw} aria-label={`Withdraw approval of ${tool.name}`}>
              <X aria-hidden /> Withdraw approval
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={approve.isPending} onClick={() => approve.mutate(true)} aria-label={`Approve ${tool.name}`}>
              <Check aria-hidden /> Approve
            </Button>
          )}
        </div>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(false);
            approve.reset();
          }
        }}
        title={`Withdraw approval of ${tool.name}?`}
        description="These published agents stop offering the tool from their next answer. Their editors see a warning until they publish without it."
        confirmLabel="Withdraw approval"
        busy={approve.isPending}
        error={approve.error}
        onConfirm={() => approve.mutate(false)}
      >
        <AgentUses uses={uses} label={`Agents that use ${tool.name}`} />
      </AlertDialog>
    </li>
  );
}
