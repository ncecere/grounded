/* Which data sources a knowledge base can attach (pure, unit-tested). */

type Candidate = { id: string; embeddingProfileId: string; classification: string };
type SharedCandidate = Candidate & { status: string };

type AttachInput<S extends Candidate, H extends SharedCandidate> = {
  /** Ids already attached. */
  attached: Set<string>;
  embeddingProfileId: string;
  sources: S[];
  shared: H[];
  /** Rank of a classification key (undefined when unknown). */
  rank: (classification: string) => number | undefined;
  /** Rank of the team's approved classification. */
  teamMax: number | undefined;
};

/**
 * Team sources split by embedding profile, and the active shared sources the
 * team may attach: same profile, and no more sensitive than the team is
 * approved for. `sharedHidden` counts the active shared sources left out.
 */
export function attachOptions<S extends Candidate, H extends SharedCandidate>({ attached, embeddingProfileId, sources, shared, rank, teamMax }: AttachInput<S, H>) {
  const unattached = sources.filter((src) => !attached.has(src.id));
  const compatible = unattached.filter((src) => src.embeddingProfileId === embeddingProfileId);
  const incompatible = unattached.filter((src) => src.embeddingProfileId !== embeddingProfileId);
  const sharedUnattached = shared.filter((src) => !attached.has(src.id) && src.status === "active");
  const allowed = (src: H) => {
    const r = rank(src.classification);
    return teamMax !== undefined && r !== undefined && r <= teamMax;
  };
  const sharedCompatible = sharedUnattached.filter((src) => src.embeddingProfileId === embeddingProfileId && allowed(src));
  return { compatible, incompatible, sharedCompatible, sharedHidden: sharedUnattached.length - sharedCompatible.length };
}

export type AttachCandidate<S> = {
  source: S;
  shared: boolean;
  /** Why it can't be attached, or undefined when it can. */
  reason?: string;
};

type Named = Candidate & { name: string; status?: string };

/**
 * Every unattached source, team sources first, each with the reason it can't
 * be attached (W4's "Attach source" dialog). `profileName` and `levelName`
 * word the reasons; eligible sources come first within each group.
 */
export function attachCandidates<S extends Named, H extends Named>(
  input: AttachInput<S, H & SharedCandidate> & { profileName: (id: string) => string; levelName: (key: string) => string; teamMaxName: string },
): AttachCandidate<S | H>[] {
  const { attached, embeddingProfileId, rank, teamMax, profileName, levelName, teamMaxName } = input;
  const profileReason = (src: Candidate) =>
    src.embeddingProfileId === embeddingProfileId
      ? undefined
      : `Uses ${profileName(src.embeddingProfileId)}; this knowledge base uses ${profileName(embeddingProfileId)}.`;
  const team: AttachCandidate<S | H>[] = input.sources
    .filter((src) => !attached.has(src.id))
    .map((src) => ({ source: src, shared: false, reason: profileReason(src) }));
  const shared: AttachCandidate<S | H>[] = input.shared
    .filter((src) => !attached.has(src.id))
    .map((src) => {
      const r = rank(src.classification);
      const reason =
        src.status !== "active"
          ? "Paused by a platform admin."
          : profileReason(src) ??
            (teamMax === undefined || r === undefined || r > teamMax ? `Classified ${levelName(src.classification)}; your team is approved up to ${teamMaxName}.` : undefined);
      return { source: src, shared: true, reason };
    });
  const byEligibility = (a: AttachCandidate<S | H>, b: AttachCandidate<S | H>) => Number(Boolean(a.reason)) - Number(Boolean(b.reason));
  return [...team.sort(byEligibility), ...shared.sort(byEligibility)];
}
