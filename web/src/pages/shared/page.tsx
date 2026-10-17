/*
 * A shared conversation (/shared/$token; v0.6.0, C12; ADR-0010): a read-only snapshot of someone's conversation with an agent, opened by its link.
 * It is outside the app shell, so it reads the same signed in or not. The server decides who may open it: a person who may chat with the agent, or
 * anyone when the sharer made it open to anyone on a public agent. Anyone it refuses without a session is asked to sign in; anyone it refuses
 * after signing in is told it isn't available (the same words for a link that never existed).
 *
 * It shows the questions, the answers and their citations (a source opens beside the conversation, as in the chat). Never feedback, reasoning or
 * what the agent did to answer. The address holds the link's secret, so the page asks not to be sent on as a referrer and not to be indexed.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { Compass, Home, LogIn, LogOut, MessageSquare } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ApiError } from "../../api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { Inline } from "@/components/ui/layout/layout";
import { Time } from "@/components/ui/time/time";
import { terms } from "../../lib/terms";
import { ProductMark } from "../../components/layout/product-mark";
import { InstanceLogo, useAuthConfig, useInstance, useMe, useSignOut } from "../../session";
import { ChatMessages } from "../chat/thread";
import { ViewerHost } from "../chat/viewer/host";
import { itemsFromShared, sharedQuery } from "./data";
import c from "./shared.module.css";

/** Where "Sign in" goes: single sign-on returning here, or the sign-in page, which comes back here. */
function useSignInHref() {
  const config = useAuthConfig();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (config.data?.oidcEnabled) return `${config.data.loginUrl}?next=${encodeURIComponent(path)}`;
  return `/?next=${encodeURIComponent(path)}`;
}

/** Asks not to be sent on as a referrer while the page is open (the address has the secret). */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Bar({ children }: { children?: React.ReactNode }) {
  const instance = useInstance();
  return (
    <header className={c.bar}>
      <span className={c.brand}>
        {instance.logoUrl ? <InstanceLogo src={instance.logoUrl} className={c.logo} /> : <ProductMark className={c.logo} small />}
        <span className={instance.logoUrl ? "sr-only" : undefined}>{instance.name}</span>
      </span>
      {children}
    </header>
  );
}

export function SharedPage() {
  const { token } = useParams({ from: "/shared/$token" });
  useNoReferrer();
  const me = useMe();
  const viewer = me.data?.user.id ?? "anonymous";
  const shared = useQuery({ ...sharedQuery(token, viewer), enabled: !me.isLoading });
  const signIn = useSignInHref();
  const signOut = useSignOut();
  const instanceName = useInstance().name;
  const view = shared.data;
  useEffect(() => {
    document.title = view ? `${view.title || "Shared conversation"} · ${instanceName}` : `Shared conversation · ${instanceName}`;
  }, [view, instanceName]);
  const items = useMemo(() => itemsFromShared(view?.messages ?? []), [view]);

  if (me.isLoading || shared.isLoading) return <Loading className={c.full} label="Opening the conversation…" />;
  if (!view) {
    const signInFirst = shared.error instanceof ApiError && shared.error.status === 401;
    return (
      <div className={c.shell}>
        <Bar />
        <main className={c.main}>
          <EmptyState
            titleAs="h1"
            icon={signInFirst ? <LogIn /> : <MessageSquare />}
            title={signInFirst ? "Sign in to open this conversation" : "This conversation isn't available"}
            description={
              signInFirst
                ? "It was shared with the people who can use this agent. Sign in, and it opens here."
                : "The link may have been turned off, the conversation or the agent removed, or it was shared with people who can use an agent you can't. Ask the person who sent it."
            }
            action={
              signInFirst ? (
                <Button render={<a href={signIn} />}>
                  <LogIn aria-hidden /> Sign in
                </Button>
              ) : (
                // Not a dead end (#128): the way into the app, and out of this account.
                <Inline gap={2} justify="center">
                  <Button render={<Link to="/" />}>
                    <Home aria-hidden /> Home
                  </Button>
                  {me.data && (
                    <Button variant="secondary" render={<Link to="/agents" />}>
                      <Compass aria-hidden /> {terms.discoverAgents}
                    </Button>
                  )}
                  {me.data && (
                    <Button variant="ghost" loading={signOut.isPending} onClick={() => signOut.mutate()}>
                      <LogOut aria-hidden /> Sign out
                    </Button>
                  )}
                </Inline>
              )
            }
          />
        </main>
      </div>
    );
  }
  const agent = { name: view.agent.name, accentColor: view.agent.accentColor, description: view.agent.description };
  return (
    <div className={c.shell}>
      <Bar>
        {me.data ? null : (
          <Button variant="secondary" size="sm" render={<a href={signIn} />}>
            <LogIn aria-hidden /> <span className={c.barLabel}>Sign in</span>
          </Button>
        )}
      </Bar>
      <main className={c.main}>
        <div className={c.head}>
          <div className={c.heading}>
            <h1 className={c.title}><bdi>{view.title || "Shared conversation"}</bdi></h1>
            <p className={c.meta}>
              With <bdi>{view.agent.name}</bdi>
              {view.sharedBy ? <> · shared by <bdi>{view.sharedBy}</bdi></> : ""} · <Time value={view.sharedAt} format="datetime" />
            </p>
          </div>
          <Button render={<Link to="/a/$team/$agent" params={{ team: view.agent.teamSlug, agent: view.agent.slug }} />}>
            <MessageSquare aria-hidden /> Ask {view.agent.name}
          </Button>
        </div>
        <Alert tone="info" title="A shared conversation">
          {view.owner ? "You shared this conversation. " : ""}This is a read-only copy of the conversation as it was when it was shared. Later messages are not in it, and it has no feedback or
          reasoning.
        </Alert>
        {/* A bounded stage: the conversation and an open source each scroll in their own pane, as in the chat. */}
        <div className={c.stage}>
          <ViewerHost access={{ kind: "shared", token }} items={items}>
            <section aria-label={`Shared conversation with ${view.agent.name}`} className={c.thread}>
              <ChatMessages items={items} agent={agent} />
            </section>
          </ViewerHost>
        </div>
      </main>
    </div>
  );
}
