/*
 * Whether the team Overview's dashboard has what it shows (VI-14b). The page
 * waits for the counts, needs-attention rows and quality & spend cards
 * before rendering them, so cards don't appear one by one and push the rest
 * down (a layout shift of 0.10). The same queries as the cards (shared
 * cache); a disabled query (a role that doesn't see it) doesn't wait.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { teamLimitsQuery } from "../../../lib/limits";
import { useAgents } from "../../agents/common";
import { useKBs, useSources, useTeam } from "../common";
import { useDomainRequests } from "../domains";
import { evalSetsQuery, useEvaluationsOn } from "../evaluations/queries";
import { useTeamSpend } from "../spend";

export function useOverviewReady() {
  const { slug, role, canEdit, isManager } = useTeam();
  const evaluationsOn = useEvaluationsOn();
  const waiting = [
    useSources(slug),
    useKBs(slug),
    useAgents(slug),
    useDomainRequests(slug),
    useQuery({ ...teamLimitsQuery(slug), enabled: role !== "member" }),
    useQuery({ ...evalSetsQuery(slug), enabled: canEdit && evaluationsOn }),
    useTeamSpend(slug, isManager),
  ].some((q) => q.isLoading);
  // Once ready, it stays ready: a card that mounts refetches a query that failed (cost tracking off: 404), which
  // puts it back to loading, and waiting again would unmount the cards and loop.
  const [ready, setReady] = useState(false);
  if (!waiting && !ready) setReady(true);
  return ready || !waiting;
}
