/*
 * Citation chips and "Uncited" marks in an answer (docs/systemone.md §3).
 *
 * With SystemOne citation checks, each [n] marker has its own verdict: the
 * verdict on the sentence (list item, table row) it sits in, in
 * citation.markers, one entry per [n] of that source in order. A remark
 * plugin numbers each marker's occurrence in document order, so the chip for
 * the second [2] shows markers[1]. Answers checked before per-marker verdicts
 * (and markers past the list) show the source's own verdict.
 *
 * Factual sentences without a citation (answer.uncited, code point offsets)
 * get a small "Uncited" mark after them: a private-use sentinel is put into
 * the text at each sentence's end, and a second plugin turns it into a mark.
 *
 * Answers checked by v0.2.1 or later have claims (claims.tsx): a chip then
 * shows the verdict of its claim, found by the marker's occurrence, and its
 * card the claim's text above the passage.
 *
 * A chip opens its card on hover, click, Enter or Space (focus moves into the
 * card, Escape returns it to the chip), so keyboard and screen-reader users
 * get the claim too: it is the card's description. The card's "Show source n"
 * opens the source viewer where the chat has one (viewer/, docs/v0.4.0.md §5);
 * elsewhere its "Show source n below" opens the sources under the answer and
 * focuses that one.
 *
 * Sources are shown numbered 1..n in the order the answer first cites them,
 * whatever the numbers the model cited ([2], [1], [4] read 1, 2, 3); the stored
 * numbers don't change (displayNumbers, US-03). A chip keeps the punctuation right after it
 * on its line (remarkChipPunctuation).
 */
import type { ComponentPropsWithRef, ReactNode } from "react";
import { useMemo } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { type CitationSourceAction, InlineCitation } from "@/components/ui/inline-citation/inline-citation";
import { verificationLabel, worstVerification } from "@/lib/systemone";
import { type Claim, ClaimQuote, claimChipVerification, claimLabel, claimOfMarker } from "./claims";
import { displayNumbers } from "./answer-text";
import type { Citation, UncitedSentence } from "./stream";
import a from "./answer.module.css";

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } };

function walk(node: MdNode, fn: (n: MdNode) => void) {
  fn(node);
  node.children?.forEach((c) => walk(c, fn));
}

/** Numbers each marker's sources by occurrence: data-occurrence "0,2" for the 1st [1] and the 3rd [2] of a group. */
export function remarkMarkerOccurrences() {
  return (tree: MdNode) => {
    const seen = new Map<string, number>();
    walk(tree, (n) => {
      const props = n.type === "citationMarker" ? n.data?.hProperties : undefined;
      if (!props || typeof props.dataCitation !== "string") return;
      props.dataOccurrence = props.dataCitation
        .split(",")
        .map((num) => {
          const k = seen.get(num) ?? 0;
          seen.set(num, k + 1);
          return k;
        })
        .join(",");
    });
  };
}

/** Marks the end of an uncited sentence in the text (never written by a model). */
const SENTINEL = "\ue000";

/** Splits text at the sentinels into "Uncited" marks; a sentinel anywhere else (code) is dropped. */
export function remarkUncitedMarks() {
  return (tree: MdNode) =>
    walk(tree, (n) => {
      if (!n.children) {
        if (n.value?.includes(SENTINEL)) n.value = n.value.replaceAll(SENTINEL, "");
        return;
      }
      if (n.type === "link" || n.type === "linkReference") return;
      n.children = n.children.flatMap((c) => {
        if (c.type !== "text" || !c.value?.includes(SENTINEL)) return [c];
        return c.value.split(SENTINEL).flatMap((part, i): MdNode[] => [
          ...(i > 0 ? [{ type: "uncitedMark", data: { hName: "span", hProperties: { dataUncited: "" } }, children: [] }] : []),
          ...(part ? [{ type: "text", value: part }] : []),
        ]);
      });
    });
}

/** Punctuation that belongs with the chip before it ("…refunded [3]." never leaves the "." alone on a line). */
const TRAIL = /^[.,;:!?)\]\u201d\u2019"']+/;

/** The longest word kept on one line with the chip after it: a longer one (a URL) may still break. */
const MAX_GLUED = 24;
const plain = (n: MdNode): string => n.value ?? n.children?.map(plain).join("") ?? "";
const gluable = (n: MdNode | undefined) => Boolean(n && n.type !== "text" && n.children && plain(n) && !/\s/.test(plain(n)) && plain(n).length <= MAX_GLUED);

/**
 * Takes the word before a chip off the end of `out`, to go in the chip's no-wrap span: a no-break space alone doesn't
 * keep a chip (an inline block) with the word before it, browsers may break around it anyway (US-10). A short inline
 * node without spaces (a link, bold or code) goes too when nothing but a space separates it from the chip.
 */
function takeWordBefore(out: MdNode[]): MdNode[] {
  const prev = out[out.length - 1];
  if (prev?.type !== "text" || !prev.value) return gluable(prev) ? [out.pop()!] : [];
  const m = /(\S*)([ \t\u00a0]*)$/.exec(prev.value)!;
  const word = m[1] ?? "";
  if (word.length > MAX_GLUED || (!word && !m[2])) return [];
  prev.value = prev.value.slice(0, prev.value.length - m[0].length);
  if (!prev.value) out.pop();
  const taken = { type: "text", value: word + (m[2] ? "\u00a0" : "") };
  if (word || !gluable(out[out.length - 1])) return [taken];
  return [out.pop()!, taken];
}

/** A paragraph of nothing but markers and punctuation ("[1]." after a list). */
const markersOnly = (n: MdNode) =>
  n.type === "paragraph" &&
  Boolean(n.children?.some((c) => c.type === "citationMarker")) &&
  Boolean(n.children?.every((c) => c.type === "citationMarker" || (c.type === "text" && /^[\s.,;:!?)\]]*$/.test(c.value ?? ""))));

/** The last paragraph inside a list (its last item's), or the node itself when it's a paragraph. */
function lastParagraph(n: MdNode | undefined): MdNode | undefined {
  if (!n) return undefined;
  if (n.type === "paragraph") return n;
  if (n.type !== "list" && n.type !== "listItem") return undefined;
  return lastParagraph(n.children?.[n.children.length - 1]);
}

/** A chip the model put on a line of its own after a list or paragraph joins the end of it (US-10). */
function joinLoneMarkers(tree: MdNode) {
  walk(tree, (n) => {
    if (!n.children?.some(markersOnly)) return;
    const out: MdNode[] = [];
    for (const c of n.children) {
      const host = markersOnly(c) ? lastParagraph(out[out.length - 1]) : undefined;
      if (host?.children) host.children.push({ type: "text", value: " " }, ...c.children!);
      else out.push(c);
    }
    n.children = out;
  });
}

/** Wraps markers and the punctuation right after them in a span that doesn't break (data-chip-tail). */
export function remarkChipPunctuation() {
  return (tree: MdNode) => {
    joinLoneMarkers(tree);
    wrapChipTails(tree);
  };
}

function wrapChipTails(tree: MdNode) {
  walk(tree, (n) => {
    if (n.type === "chipTail" || !n.children?.some((c) => c.type === "citationMarker")) return;
    const out: MdNode[] = [];
    const kids = n.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
      const next = kids[i + 1];
      // The last marker of a group [1][2]: the group, the word before it and the punctuation after it stay on one
      // line, so a wrapped line never starts with a chip or its full stop (US-10).
      if (c.type !== "citationMarker" || next?.type === "citationMarker") {
        out.push(c);
        continue;
      }
      const m = next?.type === "text" ? TRAIL.exec(next.value ?? "") : null;
      const group: MdNode[] = [c];
      while (out[out.length - 1]?.type === "citationMarker") group.unshift(out.pop()!);
      const word = takeWordBefore(out);
      const tail = m ? [{ type: "text", value: m[0] }] : [];
      out.push({ type: "chipTail", data: { hName: "span", hProperties: { dataChipTail: "" } }, children: [...word, ...group, ...tail] });
      if (m && next) {
        next.value = next.value!.slice(m[0].length);
        if (!next.value) i++;
      }
    }
    n.children = out;
  });
}

export { displayNumbers } from "./answer-text";

/**
 * The text with a sentinel after each uncited sentence (after a space, so a URL
 * ending the sentence doesn't swallow it). Offsets are code points.
 */
export function withUncited(text: string, uncited: UncitedSentence[] | undefined) {
  if (!uncited?.length) return text;
  const ends = new Set(uncited.map((u) => u.end));
  let out = "";
  let cp = 0;
  for (const ch of text.replaceAll(SENTINEL, "")) {
    if (ends.has(cp)) out += ` ${SENTINEL}`;
    out += ch;
    cp++;
  }
  return ends.has(cp) ? `${out} ${SENTINEL}` : out;
}

/** The subtle mark after a factual sentence that cites nothing. */
export function UncitedMark() {
  return (
    <span className={a.uncited}>
      Uncited<span className="sr-only">: no source is cited for this sentence</span>
    </span>
  );
}

/** The verdict of a source's k-th marker, or the source's own when there is none per marker. */
function markerVerdict(s: Citation, k: number | undefined) {
  const m = k === undefined ? undefined : s.markers?.[k];
  return m ?? { verification: s.verification, confidence: s.confidence };
}

type ChipSource = Parameters<typeof InlineCitation>[0]["sources"][number];
type ChipProps = {
  byN: Map<number, Citation>;
  onActivate: (n: number) => void;
  /** The card's action for a source, shown with its number: "Show source 2 below" by default. */
  actionLabel: (s: Citation, shown: number) => string;
  sourceProps: (s: Citation) => ChipSource;
  claims?: Claim[];
  num: (n: number) => number;
};

/** The card's "Show source n below" (the source's card under the answer). */
export const jumpBelow = (_: Citation, shown: number) => `Show source ${shown} below`;

/**
 * The card's way to the source, after the passage: the viewer or the source's card under the answer (bitop-ui's
 * sourceAction closes the card as it goes). `cited[i]` is the chip's i-th source.
 */
function jumpTo(cited: Citation[], { onActivate, num, actionLabel }: ChipProps): CitationSourceAction {
  return { label: (i) => actionLabel(cited[i]!, num(cited[i]!.n)), onSelect: (i) => onActivate(cited[i]!.n) };
}

/** A chip whose markers' claims carry the verdicts: the worst of a group's, explained for the deciding source. */
function claimChip(props: ChipProps, indices: number[], occurrences: number[], cited: Citation[]): ReactNode {
  const { sourceProps, claims, num } = props;
  const found = indices.map((n, i) => claimOfMarker(claims, n, occurrences[i]));
  const marks = found.map((c, i) => (c ? claimChipVerification(c, indices[i]!) : undefined));
  const verification = worstVerification(marks);
  const at = marks.findIndex((m) => m === verification);
  const sources = cited.map((s, i): ChipSource => {
    const base = sourceProps(s);
    const claim = found[i];
    return claim ? { ...base, description: <ClaimQuote claim={claim} />, quote: base.description } : base;
  });
  return (
    <InlineCitation
      index={indices.map(num)}
      className={a.chip}
      verification={verification}
      verificationLabel={verification && at >= 0 ? claimLabel(found[at]!, indices[at]!, num) : undefined}
      sources={sources}
      sourceAction={jumpTo(cited, props)}
    />
  );
}

/** A chip for a marker's numbers and their occurrences; undefined when a number has no source (it stays text). */
function chip(props: ChipProps, indices: number[], occurrences: number[]): ReactNode {
  const { byN, sourceProps, num } = props;
  const cited = indices.map((n) => byN.get(n));
  if (cited.some((s) => !s)) return undefined;
  if (props.claims) return claimChip(props, indices, occurrences, cited as Citation[]);
  const verdicts = cited.map((s, i) => markerVerdict(s!, occurrences[i]));
  // A group marker [1][2] shows the worst verdict of its sources.
  const verification = worstVerification(verdicts.map((v) => v.verification));
  const deciding = verdicts.find((v) => v.verification === verification);
  return (
    <InlineCitation
      index={indices.map(num)}
      className={a.chip}
      verification={verification}
      verificationLabel={verification ? verificationLabel(verification, deciding?.confidence) : undefined}
      sources={cited.map((s) => sourceProps(s!))}
      sourceAction={jumpTo(cited as Citation[], props)}
    />
  );
}

type SupProps = ComponentPropsWithRef<"sup"> & ExtraProps;
type SpanProps = ComponentPropsWithRef<"span"> & ExtraProps;
const plugins = [remarkMarkerOccurrences, remarkUncitedMarks, remarkChipPunctuation];

/**
 * Response props for an answer: marker chips with the verdicts of their claims (or, for answers without claims,
 * per-marker verdicts), and "Uncited" marks. `onActivate(n)` is the card's action, labelled by `actionLabel`.
 */
export function useAnswerMarkers(
  citations: Citation[],
  onActivate: (n: number) => void,
  sourceProps: ChipProps["sourceProps"],
  claims?: Claim[],
  actionLabel: ChipProps["actionLabel"] = jumpBelow,
  /** The answer's text: sources are numbered by their first citation in it. */
  text = "",
) {
  return useMemo(() => {
    const props: ChipProps = { byN: new Map(citations.map((s) => [s.n, s])), onActivate, actionLabel, sourceProps, claims, num: displayNumbers(citations, text) };
    const components: Components = {
      sup({ node: _node, children, ...rest }: SupProps) {
        const data = rest as Record<string, unknown>;
        if (typeof data["data-citation"] !== "string") return <sup {...rest}>{children}</sup>;
        const indices = data["data-citation"].split(",").map(Number);
        const occurrences = String(data["data-occurrence"] ?? "").split(",").map((k) => (k === "" ? undefined : Number(k)));
        return <>{chip(props, indices, occurrences as number[]) ?? children}</>;
      },
      span({ node: _node, ...rest }: SpanProps) {
        if ("data-uncited" in rest) return <UncitedMark />;
        return "data-chip-tail" in rest ? <span className={a.chipTail}>{rest.children}</span> : <span {...rest} />;
      },
    };
    // renderCitation turns marker parsing on; the sup renderer above draws the chips.
    const renderCitation = (indices: number[]) => chip(props, indices, []);
    return { components, renderCitation, remarkPlugins: plugins };
  }, [citations, onActivate, actionLabel, sourceProps, claims, text]);
}
