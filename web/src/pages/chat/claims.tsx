/*
 * Per-claim verification (docs/systemone.md §3, v0.2.1 I9). A claim is one
 * factual sentence of the answer with one verdict: supported (by which
 * sources), not supported, or uncited (unchecked when the check failed).
 * A marker chip shows its claim's verdict and its card the claim's text
 * above the passage; the answer gets a one-line summary near its sources.
 *
 * Answers stored before v0.2.1 have no claims: they keep their per-marker
 * verdicts and "Uncited" marks (citations.tsx).
 */
import type { Schemas } from "@/api/client";
import { pct, type CitationVerification } from "@/lib/systemone";
import type { UncitedSentence } from "./stream";
import a from "./answer.module.css";

export type Claim = Schemas["Claim"];

/** The claim a marker cites for: the one whose check of source n is the given [n] occurrence. */
export function claimOfMarker(claims: Claim[] | undefined, n: number, occurrence: number | undefined) {
  if (!claims || occurrence === undefined) return undefined;
  return claims.find((c) => c.checks?.some((k) => k.n === n && k.occurrence === occurrence));
}

/** The chip's mark for a claim: its verdict (a contradicting source shows as contradicted); none when unchecked. */
export function claimChipVerification(claim: Claim, n: number): Exclude<CitationVerification, "unchecked"> | undefined {
  if (claim.verdict === "supported") return "verified";
  if (claim.verdict !== "not_supported") return undefined;
  return claim.checks?.find((k) => k.n === n)?.verification === "contradicted" ? "contradicted" : "unsupported";
}

const conf = (c?: number | null) => (c == null ? "" : ` (${pct(c)} confidence)`);
const sourceList = (ns: number[]) => (ns.length === 1 ? `source ${ns[0]}` : `sources ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`);

/** What a chip's card and accessible name say about its claim and this source ("Claim supported by this source (95% confidence)"). */
export function claimLabel(claim: Claim, n: number) {
  const own = claim.checks?.find((k) => k.n === n);
  if (claim.verdict === "supported") {
    if (claim.sources.includes(n)) return `Claim supported by this source${conf(own?.confidence)}`;
    return `Claim supported by ${sourceList(claim.sources)}; ${own?.verification === "contradicted" ? "this source contradicts it" : "not by this source"}`;
  }
  if (claim.verdict === "not_supported") {
    const how = own?.verification === "contradicted" ? "this source contradicts it" : "this source doesn't support it";
    return `Claim not supported: ${how}${conf(own?.confidence)}`;
  }
  return undefined;
}

/** The uncited claims as sentences for the "Uncited" marks. */
export const uncitedOfClaims = (claims: Claim[]): UncitedSentence[] => claims.filter((c) => c.verdict === "uncited").map((c) => ({ start: c.start, end: c.end }));

/** Counts for the summary: unchecked claims are left out, as in evaluation scores. */
export function claimCounts(claims: Claim[]) {
  const n = (v: Claim["verdict"]) => claims.filter((c) => c.verdict === v).length;
  const supported = n("supported");
  const uncited = n("uncited");
  const unchecked = n("unchecked");
  return { supported, uncited, unchecked, scored: supported + n("not_supported") + uncited };
}

/** "9 of 10 claims supported · 1 uncited · 1 not checked"; empty without scored claims. */
export function claimSummaryText(claims: Claim[]) {
  const { supported, uncited, unchecked, scored } = claimCounts(claims);
  if (scored === 0) return "";
  const parts = [`${supported} of ${scored} ${scored === 1 ? "claim" : "claims"} supported`];
  if (uncited) parts.push(`${uncited} uncited`);
  if (unchecked) parts.push(`${unchecked} not checked`);
  return parts.join(" · ");
}

/** The answer's one-line summary of its claims, shown near its sources. */
export function ClaimSummary({ claims }: { claims: Claim[] | undefined }) {
  const text = claims ? claimSummaryText(claims) : "";
  if (!text) return null;
  return (
    <p className={a.claimSummary} data-testid="claim-summary">
      {text}
    </p>
  );
}

/** A chip card's claim line, above the cited passage. */
export function ClaimQuote({ claim }: { claim: Claim }) {
  return (
    <>
      <span className={a.claimLabel}>Claim: </span>
      <span className={a.claimText}>{claim.text}</span>
    </>
  );
}
