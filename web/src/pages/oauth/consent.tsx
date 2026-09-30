/*
 * The OAuth consent page (docs/mcp.md, "Signing in with OAuth"): an AI tool
 * asks to search knowledge bases and ask agents as the signed-in person.
 * The authorization endpoint (/oauth/authorize) checked the request and
 * sent the browser here with its parameters; this page reads them again
 * (GET /v1/oauth/consent), names the client and the host that vouches for
 * it (a registered client's name and website are its own claims, since
 * anyone can register anything: they read as such, and the host that really
 * receives the answer is named in the warning), the person's teams, and
 * sends the decision (POST, with the app's CSRF token). The server
 * returns where to go: the client, with a code or access_denied. A request
 * that isn't valid is shown here and never sent anywhere.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Avatar } from "@/components/ui/avatar/avatar";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card, CardBody } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useCurrentUser, useInstance } from "@/session";
import styles from "./consent.module.css";

type Consent = Schemas["OAuthConsent"];

/** Leaves the app for the client (a seam for tests). */
export const redirectTo = { go: (url: string) => window.location.assign(url) };
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
    onSuccess: (out) => redirectTo.go(out.redirectUrl),
  });
  const clientName = view.data?.client.name;
  useEffect(() => {
    if (clientName) document.title = `Connect ${clientName} · ${instance.name}`;
    else if (view.error != null) document.title = `Can't connect this app · ${instance.name}`;
  }, [clientName, view.error, instance.name]);
  const teams = me.teams.filter((t) => t.status === "active").map((t) => t.name);

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
            {view.data && <ConsentBody consent={view.data} instanceName={instance.name} email={me.user.email} teams={teams} decide={decide} />}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function listFormat(items: string[], max = 3) {
  if (items.length <= 1) return items.join("");
  const shown = items.slice(0, items.length > max ? max : items.length - 1);
  const rest = items.length > max ? `${items.length - max} more` : items[items.length - 1];
  return `${shown.join(", ")} and ${rest}`;
}

type BodyProps = { consent: Consent; instanceName: string; email: string; teams: string[]; decide: ReturnType<typeof useMutation<{ redirectUrl: string }, Error, Decision>> };

/** Where the app says it's from: a fact for a metadata document's host, the app's own claim for a registered one. */
function ClientHost({ host, unverified }: { host: string; unverified: boolean }) {
  if (!host) return <>It didn't give a website</>;
  if (unverified) return <>Says it's from {host}</>;
  return (
    <>
      From <strong>{host}</strong>
    </>
  );
}

function ConsentBody({ consent, instanceName, email, teams, decide }: BodyProps) {
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
            <ClientHost host={client.host} unverified={unverified} />{" "}
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
          This app registered itself, so its name and website aren't checked. Your answer goes to <strong>{consent.redirectHost}</strong>. Allow it only
          if you just connected it yourself.
        </Alert>
      )}
      <div>
        <h2 className={styles.heading}>It will be able to</h2>
        <ul className={styles.list}>
          <li>
            <Check aria-hidden /> {teams.length > 0 ? `Search knowledge bases and ask agents in ${listFormat(teams)}, as you` : "Search knowledge bases and ask agents of the teams you join, as you"}
          </li>
        </ul>
        {teams.length === 0 && <p className={styles.muted}>You're not in any team yet, so it can't reach anything until you join one.</p>}
        <p className={styles.muted}>
          It can't change any settings. What it asks is saved as your conversations and counts toward your teams' usage. You can disconnect it at any time
          from <TextLink render={<Link to="/settings/connected-apps" />}>Connected apps</TextLink> in your account menu.
        </p>
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
