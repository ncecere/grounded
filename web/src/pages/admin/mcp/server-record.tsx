/*
 * One MCP server in a RecordPage: its settings (absolute dates), stored
 * health, a Test that reads its tool list, and its tools with approval
 * (tools.tsx).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { RecordPage } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Time } from "@/components/ui/time/time";
import { perCallText, useCostSettings } from "@/lib/costs";
import s from "../../shared.module.css";
import { EnabledBadge } from "../models/common";
import { type HealthCheck, healthFacts, refreshHealth } from "../models/health";
import m from "../models/models.module.css";
import { type MCPServer, serversKey, testErrorLabels } from "./common";
import { ToolList } from "./tools";

type Props = {
  server?: MCPServer;
  health?: HealthCheck;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  isAdmin: boolean;
  levelName: (key: string) => string;
  onEdit: (x: MCPServer) => void;
  onDelete: (x: MCPServer) => void;
};

export function ServerRecordPage({ server, health, open, loading, onClose, isAdmin, levelName, onEdit, onDelete }: Props) {
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: async (id: string) => unwrap(await api.POST("/v1/admin/mcp-servers/{serverId}/test", { params: { path: { serverId: id } } })),
    onSettled: () => void refreshHealth(qc),
  });
  const x = server;
  const currency = useCostSettings().data?.currency ?? "USD";
  return (
    <RecordPage
      open={open}
      onClose={() => {
        test.reset();
        onClose();
      }}
      title={x?.name ?? "MCP server"}
      description="A remote MCP server. Agents call only its approved tools."
      loading={loading && !x}
      error={!loading && open && !x ? new Error("This MCP server no longer exists.") : undefined}
      facts={
        x
          ? [
              { label: "URL", value: <code className={s.mono}>{x.url}</code> },
              { label: "Credentials", value: x.hasAuth ? <code className={s.mono}>{`${x.authHeaderName}: ••••${x.authValueHint}`}</code> : "None" },
              { label: "Data up to", value: levelName(x.maxClassification) },
              { label: "Timeout", value: `${x.timeoutSeconds} s` },
              { label: "Price per call", value: perCallText(x.pricePerCall, currency) },
              { label: "Status", value: <EnabledBadge enabled={x.enabled} /> },
              ...healthFacts(health),
              { label: "Tools read", value: x.toolsRefreshedAt ? <Time value={x.toolsRefreshedAt} /> : "Not yet" },
              { label: "Description", value: x.description || undefined },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        x
          ? [
              {
                title: "Test",
                hidden: !isAdmin,
                content: (
                  <div className={m.sheetForm}>
                    <div>
                      <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate(x.id)}>
                        <FlaskConical aria-hidden /> Test server
                      </Button>
                    </div>
                    <ErrorAlert error={test.error} />
                    {test.data?.ok ? (
                      <Alert tone="success" title={`Connected in ${test.data.latencyMs.toLocaleString()} ms`}>
                        The server lists {test.data.toolCount} tools. No tool was called.
                      </Alert>
                    ) : test.data ? (
                      <Alert tone="danger" title="The test failed.">
                        {test.data.errorClass ? testErrorLabels[test.data.errorClass] : "The server couldn't be read"}
                        {test.data.httpStatus ? ` (HTTP ${test.data.httpStatus})` : ""}. <span className={m.detail}>{test.data.message}</span>
                      </Alert>
                    ) : null}
                  </div>
                ),
              },
              {
                title: `Tools (${x.approvedCount} of ${x.toolCount} approved)`,
                content: <ToolList server={x} isAdmin={isAdmin} onChanged={() => void qc.invalidateQueries({ queryKey: serversKey, exact: true })} />,
              },
            ]
          : []
      }
      actions={
        x &&
        isAdmin && (
          <>
            <Button variant="danger" onClick={() => onDelete(x)}>
              <Trash2 aria-hidden /> Delete
            </Button>
            <Button onClick={() => onEdit(x)}>
              <Pencil aria-hidden /> Edit
            </Button>
          </>
        )
      }
    />
  );
}
