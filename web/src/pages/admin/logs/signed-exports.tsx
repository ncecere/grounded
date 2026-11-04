/*
 * Admin → Logs → Signed daily exports (E5, ADR-0034, docs/signed-daily-audit-export.md): the approval, the operator's
 * signing key and each day's signed export. Platform admins change it; auditors see the same facts read only. Opening the
 * page reads stored state only: nothing is exported, signed or uploaded until an admin asks.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { useIsPlatformAdmin } from "../hooks";
import s from "./signed-exports.module.css";

type Export = Schemas["AuditExportStatus"];

const stateTone = { completed: "success", pending: "info", failed: "danger" } as const;
const stateLabel = { completed: "Signed", pending: "In progress", failed: "Failed" } as const;

export function SignedExports() {
  const admin = useIsPlatformAdmin();
  const settings = useQuery({ queryKey: ["audit-export-settings"], queryFn: async () => unwrap(await api.GET("/v1/admin/audit-export-settings")) });
  const exports = useQuery({ queryKey: ["audit-exports"], queryFn: async () => unwrap(await api.GET("/v1/admin/audit-exports")) });
  const [start, setStart] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cfg = settings.data;

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await Promise.all([settings.refetch(), exports.refetch()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export request failed");
    } finally {
      setBusy(false);
    }
  }
  const refresh = () => void act(async () => undefined);

  return (
    <Card
      title="Signed daily exports"
      description="A signed, hash-chained file of each closed UTC day's audit facts, for keeping outside Grounded. IDs, times, actions and targets only: never metadata, names, before-and-after values or content."
      actions={
        <Button variant="ghost" size="sm" loading={busy} onClick={refresh}>
          <RefreshCw aria-hidden /> Refresh
        </Button>
      }
    >
      <Stack gap={5}>
        {(settings.error || exports.error) && <Alert tone="danger" title="Export information could not be loaded">Refresh to try again.</Alert>}
        {cfg && (
          <DescriptionList
            dividers
            items={[
              { label: "Daily exports", value: cfg.enabled ? <StatusBadge tone="success">Approved</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge> },
              { label: "Coverage starts", value: `${cfg.coverageStart} (UTC)` },
              { label: "Destination", value: "Built-in private storage" },
              { label: "Operator signing key", value: cfg.keyReady ? <code className={s.key}>{cfg.keyId}</code> : "Unavailable: an operator must configure a private signing-key file." },
            ]}
          />
        )}
        {cfg && admin && (
          <div className={s.controls}>
            {!cfg.enabled && (
              <Field label="First covered UTC day" description="Facts before it are never exported. It cannot change once a day has been asked for.">
                <Input type="date" value={start || cfg.coverageStart} onValueChange={setStart} />
              </Field>
            )}
            <Button
              variant={cfg.enabled ? "secondary" : "primary"}
              loading={busy}
              disabled={!cfg.keyReady && !cfg.enabled}
              onClick={() => void act(async () => unwrap(await api.PUT("/v1/admin/audit-export-settings", { params: { header: ifMatch(cfg.revision) }, body: { enabled: !cfg.enabled, coverageStart: start || cfg.coverageStart, destination: "builtin" } })))}
            >
              {cfg.enabled ? "Turn off daily exports" : "Approve daily exports"}
            </Button>
            {cfg.enabled && (
              <>
                <Field label="Next closed UTC day" description="Days are exported in order, from the first covered day.">
                  <Input type="date" value={day} onValueChange={setDay} />
                </Field>
                <Button loading={busy} disabled={!day} onClick={() => void act(async () => unwrap(await api.POST("/v1/admin/audit-exports", { params: { header: ifMatch(cfg.revision) }, body: { day } })))}>
                  Create daily export
                </Button>
              </>
            )}
          </div>
        )}
        {error && (
          <Alert tone="danger" title="Nothing was changed">
            {error}
          </Alert>
        )}
        {exports.data && exports.data.length > 0 && <ExportsTable rows={exports.data} admin={admin} busy={busy} act={act} />}
        <p className={s.note}>
          Late facts are carried forward to the next file, never added to an old one. A signature authenticates the facts in the file, not that the database kept every fact: keep trusted public keys and your first and latest
          checkpoints outside this system, and verify files offline (docs/signed-daily-audit-export.md).
        </p>
      </Stack>
    </Card>
  );
}

function ExportsTable({ rows, admin, busy, act }: { rows: Export[]; admin: boolean; busy: boolean; act: (w: () => Promise<unknown>) => Promise<void> }) {
  return (
    <Table caption="Signed daily exports" columns={["Day (UTC)", "State", { label: "Actions", hideLabel: true }]} stack>
      {rows.map((row) => (
        <Tr key={row.id}>
          <Td nowrap>{row.day}</Td>
          <Td>
            <StatusBadge tone={stateTone[row.state]}>{stateLabel[row.state]}</StatusBadge>
            {row.failureCode && <span className={s.code}>{row.failureCode}</span>}
          </Td>
          <Td>
            <div className={s.actions}>
              {row.state === "completed" && (
                <>
                  <Button variant="secondary" size="sm" render={<a href={`/v1/admin/audit-exports/${encodeURIComponent(row.id)}/download`} download aria-label={`Download the ${row.day} export`} />}>
                    <Download aria-hidden /> Download
                  </Button>
                  <Disclosure title={`Verification for ${row.day}`}>
                    <pre className={s.metadata}>{JSON.stringify(row.envelope, null, 2)}</pre>
                    <p className={s.note}>The public key here is information, not trust: check it against the key you keep, then verify the signature, hashes and coverage offline.</p>
                  </Disclosure>
                </>
              )}
              {row.state === "failed" && admin && (
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void act(async () => unwrap(await api.POST("/v1/admin/audit-exports/{exportId}/retry", { params: { path: { exportId: row.id }, header: ifMatch(row.revision) } })))}>
                  <RotateCcw aria-hidden /> Retry {row.day}
                </Button>
              )}
            </div>
          </Td>
        </Tr>
      ))}
    </Table>
  );
}
