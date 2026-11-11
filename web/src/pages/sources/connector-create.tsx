/* The connector part of "New data source": the type's settings, credentials, schedule and Test connection. */
import { type ReactNode, useMemo, useState } from "react";
import type { Schemas } from "../../api/client";
import { ConnectionTest } from "./connection-test";
import { CredentialFields, ScheduleField, SettingsFields, credentialsBody, validateCredentials } from "./connector-fields";
import { type ConnectorSettings, useSourceOwner } from "./owner";
import { initialValues, schemaFields, settingsBody, validateSettings } from "./schema-form";
import type { SourceTypeInfo } from "./types";

type ConnectorForm = {
  /** The fields, to put inside the page's form. */
  element: ReactNode;
  /** Whether every required setting and credential has a value. */
  valid: boolean;
  /** What to send as the new source's `connector`. */
  body: () => ConnectorSettings;
};

/** The connector fields of a new source of `type`. `showErrors` once the person has tried to submit. */
export function useConnectorForm(type: SourceTypeInfo | undefined, showErrors: boolean): ConnectorForm {
  const owner = useSourceOwner();
  const fields = useMemo(() => schemaFields(type?.configSchema), [type?.configSchema]);
  const [typed, setValues] = useState<ReturnType<typeof initialValues>>({});
  // The type may load after the first render: what was typed lies over the schema's defaults.
  const values = useMemo(() => ({ ...initialValues(fields), ...typed }), [fields, typed]);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<Schemas["SyncSchedule"]>("daily");
  const errors = validateSettings(fields, values);
  const credentialErrors = type ? validateCredentials(type, credentials) : {};
  const valid = Object.keys(errors).length + Object.keys(credentialErrors).length === 0;
  const body = (): ConnectorSettings => ({ config: settingsBody(fields, values), credentials: credentialsBody(credentials), schedule });
  return {
    valid,
    body,
    element: type ? (
      <>
        <SettingsFields fields={fields} values={values} onChange={setValues} errors={showErrors ? errors : {}} />
        <CredentialFields type={type} values={credentials} onChange={setCredentials} errors={showErrors ? credentialErrors : {}} />
        <ScheduleField value={schedule} onChange={setSchedule} />
        {owner.api.connector && (
          <ConnectionTest
            run={() => owner.api.connector!.checkNew(type.key, { config: settingsBody(fields, values), credentials: credentialsBody(credentials) })}
            blocked={valid ? undefined : "Fill in the settings and credentials to test them."}
          />
        )}
      </>
    ) : null,
  };
}
