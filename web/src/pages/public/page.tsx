/*
 * The public page of a public agent (/a/{short}, /a/id/{uuid} and the team
 * address /a/{team}/{agent}) for visitors who aren't signed in: a minimal
 * branded page outside the app shell with one header bar (instance, agent,
 * New chat, Sign in; W12). A team address
 * of an agent that isn't public shows the sign-in page (fallback) instead.
 * Signed-in people get the app's chat page and chat as themselves
 * (docs/phase4-publishing.md §5, docs/ui-review F-07).
 */
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Bot, LogIn } from "lucide-react";
import { ApiError } from "../../api/client";
import { Button } from "@/components/ui/button/button";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { InstanceLogo, useAuthConfig, useInstance } from "../../session";
import { PublicChat } from "./public-chat";
import { isTeamAddress, publicAgentQuery, publicRef } from "./session";
import p from "./public.module.css";

/** Where "Sign in" goes: single sign-on returning here, or the sign-in page, which comes back here (US-06). */
function useSignInHref(path: string) {
  const config = useAuthConfig();
  if (config.data?.oidcEnabled) return `${config.data.loginUrl}?next=${encodeURIComponent(path)}`;
  return `/?next=${encodeURIComponent(path)}`;
}

export function PublicAgentPage({ fallback }: { fallback?: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const ref = publicRef(path) ?? "";
  const signIn = useSignInHref(path);
  const agent = useQuery({ ...publicAgentQuery(ref), enabled: ref !== "" });
  if (isTeamAddress(ref) && fallback) {
    if (agent.isLoading) return <Loading label="Loading…" />;
    if (agent.error instanceof ApiError && agent.error.status === 404) return <>{fallback}</>;
  }
  return (
    <div className={p.shell}>
      <PublicAgent agentRef={ref} signIn={signIn} />
    </div>
  );
}

/** The instance's mark: its logo, or its name. */
function InstanceMark() {
  const instance = useInstance();
  return (
    <span className={p.brand}>
      {instance.logoUrl ? <InstanceLogo src={instance.logoUrl} className={p.logo} /> : null}
      <span className={instance.logoUrl ? "sr-only" : undefined}>{instance.name}</span>
    </span>
  );
}

function SignInButton({ href }: { href: string }) {
  return (
    <Button variant="secondary" size="sm" render={<a href={href} />}>
      <LogIn aria-hidden /> <span className={p.barLabel}>Sign in</span>
    </Button>
  );
}

function PublicAgent({ agentRef, signIn }: { agentRef: string; signIn: string }) {
  const agent = useQuery({ ...publicAgentQuery(agentRef), enabled: agentRef !== "" });
  // "Registrar assistant · <instance>" in the browser tab (D8).
  const instanceName = useInstance().name;
  const agentName = agent.data?.name;
  useEffect(() => {
    if (agentName) document.title = `${agentName} · ${instanceName}`;
  }, [agentName, instanceName]);
  if (agent.data) {
    // One header bar (W12): the chat's header carries the instance mark and Sign in.
    return (
      <main className={p.main}>
        <PublicChat agent={agent.data} brand={<InstanceMark />} actions={<SignInButton href={signIn} />} />
      </main>
    );
  }
  const off = agent.error instanceof ApiError && agent.error.code === "public_disabled";
  return (
    <>
      <header className={p.top}>
        <InstanceMark />
        <SignInButton href={signIn} />
      </header>
      <main className={p.main}>
        {agent.isLoading ? (
          <Loading label="Loading the assistant…" />
        ) : (
          <EmptyState
            className={p.unavailable}
            icon={<Bot />}
            titleAs="h1"
            title={off ? "Public chat is turned off" : "This assistant isn't available publicly"}
            description={off ? "Try again later." : "It may be for signed-in people only, or it no longer exists. Sign in to see the assistants you can use."}
            action={<SignInButton href={signIn} />}
          />
        )}
      </main>
    </>
  );
}
