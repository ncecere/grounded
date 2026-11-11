/*
 * Admin → Settings › Features › Source types (docs/source-types.md): the platform's switch for each source type.
 * Upload and web are on unless turned off; a connector type is off until a platform admin turns it on, after every
 * server runs the release that has it. Off: no new source of the type, and a connector type starts no sync. Sources
 * and their documents stay, and stay searchable. Audited as platform.source_type.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileUp, Globe, Plug } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { type SourceTypeInfo, sourceTypesKey, useSourceTypes } from "../../sources/types";
import { plural } from "../../team/common";
import { lockedSwitch } from "../overview/locked-switch";
import w from "./source-types.module.css";

const whatItDoes = (t: SourceTypeInfo) =>
  t.capabilities.permissions === "provider"
    ? `${t.description}. It reports who may read each document, so it needs Document permissions on.`
    : `${t.description}.`;

export function SourceTypeSwitches({ isAdmin }: { isAdmin: boolean }) {
  const types = useSourceTypes();
  const qc = useQueryClient();
  const [turningOff, setTurningOff] = useState<SourceTypeInfo | null>(null);
  const save = useMutation({
    mutationFn: async (v: { key: string; enabled: boolean }) =>
      unwrap(await api.PUT("/v1/admin/source-types/{key}", { params: { path: { key: v.key } }, body: { enabled: v.enabled } })),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: sourceTypesKey });
      toast.success(`${t.name} sources are ${t.enabled ? "on" : "off"}`, t.enabled && !t.builtIn ? "Add it to the classifications that may use it (Admin → Policy)." : undefined);
      setTurningOff(null);
    },
  });
  const list = types.data ?? [];
  const connectors = list.filter((t) => !t.builtIn);
  return (
    <Card
      title="Source types"
      description={
        <>
          What a data source can be. Turning a type off stops new sources of it, and its syncs; the sources and documents it has stay, and stay
          searchable. A type must also be allowed by a classification level to hold its data (
          <TextLink render={<Link to="/admin/policy" />}>Policy</TextLink>).
        </>
      }
    >
      <ErrorAlert error={types.error} title="Couldn't load the source types" />
      {!turningOff && <ErrorAlert error={save.error} title="Couldn't change the source type" />}
      <ul className={w.list}>
        {list.map((t) => {
          const Icon = t.key === "web" ? Globe : t.builtIn ? FileUp : Plug;
          return (
            <li key={t.key} className={w.row}>
              <Icon aria-hidden className={w.icon} />
              <div className={w.text}>
                <span className={w.name}>
                  {t.name} {!t.builtIn && <Badge variant="outline">Connector</Badge>}
                </span>
                <span className={w.description}>
                  {whatItDoes(t)}
                  {t.sources !== undefined && ` ${plural(t.sources, "source")}.`}
                </span>
              </div>
              <Switch
                label={`Allow ${t.name} sources`}
                labelPosition="start"
                checked={t.enabled}
                disabled={save.isPending}
                {...lockedSwitch(isAdmin)}
                onCheckedChange={(on) => (on ? save.mutate({ key: t.key, enabled: true }) : setTurningOff(t))}
              />
            </li>
          );
        })}
      </ul>
      {types.data && connectors.length === 0 && <p className={w.note}>This server has no connector types yet.</p>}
      <AlertDialog
        open={turningOff !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTurningOff(null);
            save.reset();
          }
        }}
        title={`Turn ${turningOff?.name ?? ""} sources off?`}
        description={`No new ${turningOff?.name ?? ""} source can be made${turningOff?.capabilities.sync && !turningOff.builtIn ? ", and the ones that exist stop syncing" : ""}. Their documents stay, and stay searchable. Turning the type on again resumes them.`}
        confirmLabel="Turn off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => turningOff && save.mutate({ key: turningOff.key, enabled: false })}
      />
    </Card>
  );
}
