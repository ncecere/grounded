/*
 * The OAuth consent page (docs/mcp.md, "Signing in with OAuth"): an AI tool
 * asks to search knowledge bases and ask agents as the signed-in person.
 * The authorization endpoint (/oauth/authorize) checked the request and
 * sent the browser here with its parameters; this page reads them again
 * (GET /v1/oauth/consent), names the client, shows the host that vouches
 * for it prominently (a registered client's name is marked unverified,
 * since anyone can register any name) and where the browser goes back to,
 * and sends the decision (POST, with the app's CSRF token). The server
 * returns where to go: the client, with a code or access_denied. A request
 * that isn't valid is shown here and never sent anywhere.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Avatar } from "@/components/ui/avatar/avatar";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card, CardBody } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { useCurrentUser, useInstance } from "@/session";
import styles from "./consent.module.css";

type Consent = Schemas["OAuthConsent"];
type Decision = "allow" | "deny";

/** The authorization request's parameters, as the endpoint passed them on. */
function requestQuery() {
  const q = new URLSearchParams(window.location.search);
  const get = (k: string) => q.get(k) ?? "";
  return {
    raw: q.toString(),
    params: {
      client_id: get("client_id"),
      redirect_uri: get("redirect_uri"),
      response_type: get("response_type"),
      code_challenge: get("code_challenge"),
      code_challenge_method: get("code_challenge_method"),
      resource: get("resource"),
      ...(q.has("state") ? { state: get("state") } : {}),
      ...(q.has("scope") ? { scope: get("scope") } : {}),
    },
  };
}

export function OAuthConsentPage() {
  const instance = useInstance();
  const me = useCurrentUser();
  const request = requestQuery();
  const view = useQuery({
    queryKey: ["oauth", "consent", request.raw],
    queryFn: async () => unwrap(await api.GET("/v1/oauth/consent", { params: { query: request.params } })),
    retry: false,
    staleTime: Infinity,
  });
  const decide = useMutation({
    mutationFn: async (decision: Decision) => unwrap(await api.POST("/v1/oauth/consent", { body: { query: request.raw, decision } })),
    onSuccess: (out) => window.location.assign(out.redirectUrl),
  });

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <p className={styles.instance}>{instance.name}</p>
        <Card>
          <CardBody>
            {view.isLoading && <Loading label="Checking the app's request…" />}
            {view.error != null && (
              <Stack gap={4}>
                <h1 className={styles.title}>Can't connect this app</h1>
                <ErrorAlert error={view.error} />
                <p className={styles.muted}>Nothing was shared with the app. Close this page and try connecting again.</p>
              </Stack>
            )}
            {view.data && <ConsentBody consent={view.data} instanceName={instance.name} email={me.user.email} decide={decide} />}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}

function ConsentBody({ consent, instanceName, email, decide }: { consent: Consent; instanceName: string; email: string; decide: ReturnType<typeof useMutation<{ redirectUrl: string }, Error, Decision>> }) {
  const { client } = consent;
  const unverified = client.kind === "registered";
  const busy = decide.isPending || decide.isSuccess;
  return (
    <Stack gap={5}>
      <div className={styles.client}>
        {client.logoUrl ? <img src={client.logoUrl} alt="" className={styles.logo} /> : <Avatar name={client.name} size="lg" decorative />}
        <div>
          <h1 className={styles.title}>
            {client.name} wants to use {instanceName} as you
          </h1>
          <p className={styles.host}>
            {client.host ? (
              <>
                From <strong>{client.host}</strong>
              </>
            ) : (
              "Its address isn't known"
            )}{" "}
            {unverified && (
              <Badge size="sm" tone="warning">
                Unverified
              </Badge>
            )}
          </p>
        </div>
      </div>
      {unverified && (
        <Alert tone="warning">
          This app registered itself, so its name isn't checked. Allow it only if you just connected it yourself.
        </Alert>
      )}
      <div>
        <h2 className={styles.heading}>It will be able to</h2>
        <ul className={styles.list}>
          <li>
            <Check aria-hidden /> Search knowledge bases and ask agents you can use, as you
          </li>
        </ul>
        <p className={styles.muted}>It can't change anything. You can disconnect it at any time from your API keys page.</p>
      </div>
      <p className={styles.muted}>
        Signed in as <strong>{email}</strong>. After you answer, you go back to <strong>{consent.redirectHost}</strong>.
      </p>
      {decide.error != null && <ErrorAlert error={decide.error} title="Couldn't send your answer" />}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => decide.mutate("deny")}>
          Deny
        </Button>
        <Button disabled={busy} loading={decide.isPending && decide.variables === "allow"} onClick={() => decide.mutate("allow")}>
          Allow
        </Button>
      </div>
    </Stack>
  );
}
