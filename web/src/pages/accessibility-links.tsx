import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "../api/client";
import { useInstance, useMe } from "../session";
import { Button } from "../components/ui/button/button";
import { Field } from "../components/ui/field/field";
import { Input } from "../components/ui/input/input";
import { ErrorAlert } from "../components/ui/alert/alert";

const key = ["accessibility-settings"];
export function AccessibilityLinks() {
  const instance = useInstance();
  const me = useMe();
  const settings = useQuery({ queryKey: key, queryFn: async () => unwrap(await api.GET("/v1/accessibility")) });
  const contact = settings.data?.contactUrl || instance.supportUrl;
  return <>
    {settings.error && <ErrorAlert error={settings.error} />}
    {contact ? <p><a href={contact}>Contact the platform support team</a></p> : <p>No reporting contact has been configured. Contact the organisation operating this installation through its usual support channel.</p>}
    {settings.data?.institutionUrl && <p><a href={settings.data.institutionUrl}>Institution accessibility statement</a></p>}
    {me.data?.user.platformRole === "platform_admin" && settings.data && <StatementLinkEditor key={settings.data.revision} settings={settings.data} />}
  </>;
}

function StatementLinkEditor({ settings }: { settings: Schemas["AccessibilitySettings"] }) {
  const qc = useQueryClient();
  const [contactUrl, setContact] = useState(settings.contactUrl);
  const [institutionUrl, setInstitution] = useState(settings.institutionUrl);
  const save = useMutation({ mutationFn: async () => unwrap(await api.PUT("/v1/admin/settings/accessibility", { body: { contactUrl, institutionUrl }, params: { header: ifMatch(settings.revision) } })), onSuccess: (data) => qc.setQueryData(key, data) });
  return <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
    <h2>Statement links — platform administrator</h2>
    <Field label="Reporting contact URL" description="HTTPS or simple mailto. Empty uses the instance support contact."><Input value={contactUrl} onChange={(e) => setContact(e.target.value)} maxLength={2048} /></Field>
    <Field label="Institution statement URL" description="Optional HTTPS link. Empty removes it."><Input value={institutionUrl} onChange={(e) => setInstitution(e.target.value)} maxLength={2048} /></Field>
    {save.error && <ErrorAlert error={save.error} />}
    <Button type="submit" disabled={save.isPending}>Save statement links</Button>
  </form>;
}
