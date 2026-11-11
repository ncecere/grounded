/*
 * A connector source's connection, in its Settings tab: the type's settings, its credentials and its schedule, saved
 * apart from the rest of the settings (docs/source-types.md). New settings or credentials make the next sync list
 * everything again.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { toast } from "@/components/ui/toast/toast";
import type { Schemas } from "../../api/client";
import { ConnectionTest } from "./connection-test";
import { CredentialFields, ScheduleField, SettingsFields, credentialsBody, validateCredentials } from "./connector-fields";
import { type ConnectorSettings, type DataSource, useSourceOwner } from "./owner";
import { initialValues, schemaFields, settingsBody, validateSettings } from "./schema-form";
import { type SourceTypeInfo, useSourceTypes } from "./types";
import w from "./connector-settings.module.css";

export function ConnectorSettingsCard({ source }: { source: DataSource }) {
  const types = useSourceTypes();
  const type = types.data?.find((t) => t.key === source.type);
  if (!source.connector) return null;
  if (!type || !source.connector.available)
    return (
      <Card title="Connection">
        <Alert tone="warning" title="This server doesn't have this source's connector">
          The source and its documents stay, and stay searchable. It can't sync, and its connection can't be changed, until a
          server with the connector for “{source.type}” runs again.
        </Alert>
      </Card>
    );
  // Remount when the stored connection changes, so the form starts from what is stored.
  return <ConnectionForm key={`${source.revision}`} source={source} type={type} />;
}

function ConnectionForm({ source, type }: { source: DataSource; type: SourceTypeInfo }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const connector = source.connector!;
  const fields = useMemo(() => schemaFields(type.configSchema), [type.configSchema]);
  const stored = useMemo(() => initialValues(fields, connector.config as Record<string, unknown>), [fields, connector.config]);
  const [values, setValues] = useState(stored);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<Schemas["SyncSchedule"]>(connector.schedule);
  const [submitted, setSubmitted] = useState(false);

  const errors = validateSettings(fields, values);
  const credentialErrors = validateCredentials(type, credentials, connector.credentialKeys);
  const invalid = Object.keys(errors).length + Object.keys(credentialErrors).length > 0;
  const config = settingsBody(fields, values);
  const configChanged = JSON.stringify(config) !== JSON.stringify(settingsBody(fields, stored));
  const newCredentials = credentialsBody(credentials);
  const dirty = configChanged || !!newCredentials || schedule !== connector.schedule;
  const body = (): ConnectorSettings => ({
    config: configChanged ? config : undefined,
    credentials: newCredentials,
    schedule: schedule !== connector.schedule ? schedule : undefined,
  });

  const save = useMutation({
    mutationFn: () => owner.api.connector!.save(source, body()),
    onSuccess: (next) => {
      qc.setQueryData(owner.keys.source(source.id), next);
      qc.invalidateQueries({ queryKey: owner.keys.list });
      toast.success("Connection saved", configChanged || newCredentials ? "The next sync lists everything again." : undefined);
    },
  });
  const disabled = !owner.canEdit || !owner.api.connector;

  return (
    <Card
      title="Connection"
      description={`${type.name}: what to index, the credentials, and how often to sync.`}
      footer={
        owner.canEdit && (
          <div className={w.footer}>
            <Button
              loading={save.isPending}
              disabled={!dirty || disabled}
              onClick={() => {
                setSubmitted(true);
                if (!invalid) save.mutate();
              }}
            >
              Save connection
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setValues(stored);
                  setCredentials({});
                  setSchedule(connector.schedule);
                  setSubmitted(false);
                  save.reset();
                }}
              >
                Discard
              </Button>
            )}
            <span className={w.note}>{submitted && invalid ? "Not saved: fix the highlighted fields." : dirty ? "Not saved yet." : ""}</span>
          </div>
        )
      }
    >
      <div className={w.fields}>
        <SettingsFields fields={fields} values={values} onChange={setValues} errors={submitted ? errors : {}} disabled={disabled} />
        <CredentialFields type={type} values={credentials} onChange={setCredentials} errors={submitted ? credentialErrors : {}} stored={connector.credentialKeys} disabled={disabled} />
        <ScheduleField value={schedule} onChange={setSchedule} disabled={disabled} />
        {owner.canEdit && owner.api.connector && (
          <ConnectionTest
            run={() => owner.api.connector!.check(source.id, { config, credentials: newCredentials })}
            blocked={Object.keys(errors).length > 0 ? "Fill in the settings to test them." : undefined}
          />
        )}
        <ErrorAlert error={save.error} title="The connection wasn't saved" />
      </div>
    </Card>
  );
}
