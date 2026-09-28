/*
 * Admin Overview › API key pepper rotation (E10, docs/operations/rotate-keys.md):
 * a notice while API keys or widget keys are not on the current
 * API_KEY_PEPPER, with the list in a dialog. Nothing shows otherwise.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Table, Td, Tr } from "@/components/ui/table/table";

export const keyRotationQuery = () => ({
  queryKey: ["admin", "key-rotation"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/key-rotation")),
  staleTime: 60_000,
});

const kindLabel: Record<Schemas["PepperKey"]["kind"], string> = { api_key: "API key", publishable_key: "Widget key" };

export function KeyRotationNotice() {
  const { data } = useQuery(keyRotationQuery());
  const [open, setOpen] = useState(false);
  const keys = data?.keys ?? [];
  if (keys.length === 0) return null;
  const previous = keys.filter((k) => k.state === "previous").length;
  const retired = keys.length - previous;
  const n = (count: number) => `${count.toLocaleString()} ${count === 1 ? "key" : "keys"}`;
  return (
    <>
      <Alert
        tone="warning"
        title={previous > 0 ? `${n(previous)} still on the previous API key pepper` : `${n(retired)} hashed with a retired API key pepper`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Show keys
          </Button>
        }
      >
        {previous > 0
          ? "Each is re-hashed with the new pepper when next used. Keys not used before API_KEY_PEPPER_PREVIOUS is removed stop working."
          : "These keys no longer work. Ask their teams to revoke them and create new ones."}
        {previous > 0 && retired > 0 && ` ${n(retired)} can no longer work and should be revoked.`}
      </Alert>
      {open && (
        <Dialog open size="xl" onOpenChange={(o) => !o && setOpen(false)} title="Keys not on the current pepper" footer={<DialogClose>Close</DialogClose>}>
          <Table caption="Keys not on the current API key pepper" columns={["Key", "Team", "Kind", "Last used", "State"]} density="compact">
            {keys.map((k) => (
              <Tr key={k.id}>
                <Td>{k.agentName ? `${k.name} (${k.agentName})` : k.name}</Td>
                <Td>{k.teamName}</Td>
                <Td>{kindLabel[k.kind]}</Td>
                <Td nowrap>{k.lastUsedAt ? <RelativeTime value={k.lastUsedAt} /> : "Never"}</Td>
                <Td>{k.state === "previous" ? "Re-hashed on next use" : "No longer works"}</Td>
              </Tr>
            ))}
          </Table>
        </Dialog>
      )}
    </>
  );
}
