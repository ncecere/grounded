import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError } from "../../api/client";
import { ApiErrorAlert } from "../../components/errors";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { TextLink } from "@/components/ui/text-link/text-link";
import { RequestDomainDialog } from "../team/domains";
import { useSourceOwner } from "./owner";
import { withScheme } from "./web-form";

/* ---------------- host_not_allowed ---------------- */

const isHostNotAllowed = (err: unknown): err is ApiError => err instanceof ApiError && err.code === "host_not_allowed";

/** The host named by a host_not_allowed error ("x.org is not on the crawl allowlist…"), else the first URL's host. */
export function hostFromError(err: ApiError, urls: string[]) {
  const named = /^([a-z0-9.-]+\.[a-z0-9-]+) is not/i.exec(err.message)?.[1];
  if (named) return named.toLowerCase();
  for (const u of urls) {
    try {
      return new URL(withScheme(u)).hostname;
    } catch {
      // Try the next URL.
    }
  }
  return "";
}

/** The team's pending request covering the host, from the error's details (P-15). */
export function pendingRequestOf(err: ApiError): { id: string; pattern: string } | undefined {
  const p = (err.details as { pendingRequest?: { id?: unknown; pattern?: unknown } } | undefined)?.pendingRequest;
  return p && typeof p.id === "string" && typeof p.pattern === "string" ? { id: p.id, pattern: p.pattern } : undefined;
}

/** Explains a host outside the allowlist and offers the way to allow it (or names the pending request). */
function HostNotAllowed({ error, urls }: { error: ApiError; urls: string[] }) {
  const owner = useSourceOwner();
  const host = hostFromError(error, urls);
  const [requesting, setRequesting] = useState(false);
  const team = owner.team;
  const pending = pendingRequestOf(error);
  return (
    <>
      <Alert
        tone={pending ? "warning" : "danger"}
        title={host ? `${host} isn't on the crawl allowlist` : "This site isn't on the crawl allowlist"}
        actions={
          team && owner.canEdit && !pending ? (
            <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}>
              Request this domain
            </Button>
          ) : undefined
        }
      >
        {team && pending ? (
          <>
            Your team's request for <strong>{pending.pattern}</strong> is waiting for a platform admin.{" "}
            <TextLink render={<Link to="/teams/$team/sources" params={{ team }} search={{ tab: "crawl-domains" }} />}>View your team's domain requests</TextLink>.
          </>
        ) : team ? (
          <>
            Web sources can only crawl allowed hosts. {owner.canEdit ? "Request the domain and a platform admin will review it. " : ""}
            <TextLink render={<Link to="/teams/$team/sources" params={{ team }} search={{ tab: "crawl-domains" }} />}>View your team's domain requests</TextLink>.
          </>
        ) : (
          <>
            Shared sources can crawl hosts on the platform allowlist. <TextLink render={<Link to="/admin/crawl-domains" search={{ tab: "allowlist" }} />}>Add it to the crawl allowlist</TextLink>{" "}
            first.
          </>
        )}
      </Alert>
      {team && requesting && <RequestDomainDialog key={host} team={team} initialPattern={host} open={requesting} onOpenChange={setRequesting} />}
    </>
  );
}

/** ErrorAlert that explains host_not_allowed with a way forward; other errors under `title` when given. */
export function WebErrorAlert({ error, urls, title }: { error: unknown; urls: string[]; title?: string }) {
  if (isHostNotAllowed(error)) return <HostNotAllowed error={error} urls={urls} />;
  return <ApiErrorAlert error={error} title={title} />;
}
