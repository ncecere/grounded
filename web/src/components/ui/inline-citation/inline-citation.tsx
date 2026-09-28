"use client";

import { Popover } from "@base-ui/react/popover";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { IconButton } from "@/components/ui/button/button";
import popup from "@/components/ui/styles/popup.module.css";
import { cx } from "@/lib/bitop-utils";
import styles from "./inline-citation.module.css";

/*
 * InlineCitation: a small numbered chip placed after a claim ("…in 2019 [1]")
 * that opens a card describing its source(s). Built on Base UI Popover with
 * openOnHover, so it opens on hover (pointer) and on click / Enter / Space
 * (keyboard, touch). Keyboard and click opens move focus into the card, so
 * the source link and the previous/next buttons are reachable with Tab; Esc
 * closes it and returns focus to the chip.
 *
 * The chip's accessible name includes the source title ("Source 1: Annual
 * report 2024"), so screen-reader users hear what is cited without opening
 * the card.
 *
 * With `onActivate`, a click / Enter / Space calls it instead of opening
 * the card (hover still previews it). Use it when the full sources are
 * listed below the answer: jump to and focus the matching Source there.
 *
 * With `verification` (the claim was checked against its source), the chip
 * carries a small check (verified) or a warning (unsupported,
 * contradicted); the explanation is part of the chip's accessible name and
 * heads the card, so it works as the icon's tooltip.
 */

/** The outcome of checking a claim against its source. */
export type CitationVerification = "verified" | "unsupported" | "contradicted";

const verificationText: Record<CitationVerification, string> = {
  verified: "Verified: the source supports this",
  unsupported: "Not supported by this source",
  contradicted: "Contradicted by this source",
};

/** The default explanation of a verification ("Not supported by this source"). */
export function citationVerificationText(v: CitationVerification): string {
  return verificationText[v];
}

export type CitationSource = {
  title: string;
  /** Link to the source. Opens in a new tab. */
  href?: string;
  /** Publisher / site name; defaults to the href's hostname. */
  siteName?: string;
  /** Short summary or snippet. */
  description?: ReactNode;
  /** The passage that supports the claim. */
  quote?: ReactNode;
  /** Decorative favicon or file-type icon. */
  icon?: ReactNode;
};

export type InlineCitationProps = {
  /** The cited source(s). With several, the card pages through them. */
  sources: CitationSource[];
  /**
   * The citation number(s), e.g. 1 or [1, 3]. Shown in the chip and used in
   * the accessible name. Without it the chip shows the first source's site.
   */
  index?: number | number[];
  /** Override the chip text. Keep it part of the accessible name (WCAG 2.5.3). */
  label?: ReactNode;
  side?: "top" | "bottom";
  /**
   * Called on click / Enter / Space instead of opening the card (hover still
   * previews it), e.g. to scroll to and focus the full source in a list.
   */
  onActivate?: () => void;
  /** The claim was checked against the source: a check (verified) or a warning (unsupported, contradicted). */
  verification?: CitationVerification;
  /** Explains the verification in the card and the chip's name; defaults per status, e.g. "Not supported by this source". */
  verificationLabel?: string;
  className?: string;
};

/** "https://www.example.com/a" → "example.com". Returns undefined for invalid URLs. */
export function citationHostname(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function chipText(sources: CitationSource[], indices: number[]): string {
  if (indices.length) return indices.join(", ");
  const first = sources[0];
  const site = first?.siteName ?? citationHostname(first?.href) ?? first?.title ?? "source";
  return sources.length > 1 ? `${site} +${sources.length - 1}` : site;
}

function accessibleName(sources: CitationSource[], indices: number[], text: string): string {
  const first = sources[0]?.title ?? "";
  const more = sources.length > 1 ? ` and ${sources.length - 1} more` : "";
  if (indices.length) return `${indices.length > 1 ? "Sources" : "Source"} ${indices.join(", ")}: ${first}${more}`;
  return `${text}: ${first}${more}`;
}

function VerificationIcon({ verification, className }: { verification: CitationVerification; className?: string }) {
  const Icon = verification === "verified" ? Check : TriangleAlert;
  return <Icon aria-hidden className={className} />;
}

export function InlineCitation({ sources, index, label, side = "top", onActivate, verification, verificationLabel, className }: InlineCitationProps) {
  const [rawPage, setPage] = useState(0);
  // The sources list can shrink while the card is open (e.g. a re-streamed
  // answer): show and page from the last source, and store that page.
  const last = Math.max(0, sources.length - 1);
  const page = Math.min(rawPage, last);
  useEffect(() => {
    if (rawPage > last) setPage(last);
  }, [rawPage, last]);
  const indices = index === undefined ? [] : Array.isArray(index) ? index : [index];
  const text = chipText(sources, indices);
  if (sources.length === 0) return null;
  const current = sources[page]!;
  const multiple = sources.length > 1;
  const site = current.siteName ?? citationHostname(current.href);
  const note = verification ? (verificationLabel ?? verificationText[verification]) : undefined;
  const name = accessibleName(sources, indices, text) + (note ? `. ${note}` : "");

  return (
    <Popover.Root
      onOpenChange={(open, details) => {
        if (onActivate && details.reason === "trigger-press") {
          details.cancel();
          onActivate();
          return;
        }
        if (!open) setPage(0);
      }}
    >
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        className={cx(styles.chip, className)}
        data-verification={verification}
        aria-label={name}
        // Pressing jumps elsewhere instead of opening a popup: don't announce one.
        {...(onActivate ? { "aria-haspopup": undefined, "aria-expanded": undefined } : {})}
      >
        {label ?? text}
        {verification && <VerificationIcon verification={verification} className={styles.mark} />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className={popup.positioner} side={side} sideOffset={6} collisionPadding={8}>
          <Popover.Popup className={cx(popup.popup, styles.card)}>
            {multiple && (
              <div className={styles.pager}>
                <IconButton
                  size="sm"
                  icon={<ChevronLeft aria-hidden />}
                  label="Previous source"
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                />
                <span className={styles.pageIndex} aria-live="polite">
                  {page + 1} of {sources.length}
                </span>
                <IconButton
                  size="sm"
                  icon={<ChevronRight aria-hidden />}
                  label="Next source"
                  disabled={page === last}
                  onClick={() => setPage(Math.min(last, page + 1))}
                />
              </div>
            )}
            <div className={styles.source}>
              {verification && (
                <p className={styles.verification} data-verification={verification}>
                  <VerificationIcon verification={verification} className={styles.verificationIcon} />
                  {note}
                </p>
              )}
              {(site || current.icon) && (
                <span className={styles.site}>
                  {current.icon && (
                    <span aria-hidden className={styles.icon}>
                      {current.icon}
                    </span>
                  )}
                  {site}
                </span>
              )}
              <Popover.Title render={<p />} className={styles.title}>
                {current.href ? (
                  <a href={current.href} target="_blank" rel="noreferrer noopener" className={styles.link}>
                    {current.title}
                    <ArrowUpRight aria-hidden className={styles.linkIcon} />{" "}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  current.title
                )}
              </Popover.Title>
              {current.description && <Popover.Description className={styles.description}>{current.description}</Popover.Description>}
              {current.quote && <blockquote className={styles.quote}>{current.quote}</blockquote>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
