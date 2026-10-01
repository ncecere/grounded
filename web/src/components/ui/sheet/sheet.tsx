"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button, IconButton, type ButtonProps } from "@/components/ui/button/button";
import { cx } from "@/lib/bitop-utils";
import styles from "./sheet.module.css";

/*
 * Sheet: a modal dialog attached to an edge of the screen, for secondary
 * tasks (filters, details, settings) that keep the page in view. Built on
 * Base UI Dialog with the same conventions as bitop's Dialog: focus is
 * trapped and returns to the trigger, Escape and the backdrop close it, the
 * title names it and the description describes it. Use Drawer instead if you
 * need swipe-to-dismiss or snap points.
 *
 *   <Sheet
 *     trigger={<Button variant="secondary">Filters</Button>}
 *     title="Filters"
 *     description="Narrow the list of deployments."
 *     footer={<><SheetClose>Cancel</SheetClose><Button>Apply</Button></>}
 *   >
 *     …fields…
 *   </Sheet>
 *
 * On a phone, a split view's side panel can open as a full-screen sheet
 * instead: `size="full"` covers the viewport (no backdrop shows around it).
 */

export type SheetSide = "right" | "left" | "top" | "bottom";
export type SheetSize = "sm" | "md" | "lg" | "xl" | "full";

export type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Heading; names the sheet. */
  title: ReactNode;
  /** Describes the sheet's purpose; read after the title by screen readers. */
  description: ReactNode;
  /** Optional trigger element, e.g. `<Button>Open</Button>`. */
  trigger?: ReactElement;
  /** Footer pinned to the bottom, usually buttons. Use <SheetClose> for Cancel. */
  footer?: ReactNode;
  /** The edge the sheet slides in from. */
  side?: SheetSide;
  /**
   * Width of left/right sheets (top/bottom sheets span the viewport width).
   * `full` covers the whole screen from any side, e.g. a side panel's
   * stand-in on a phone; keep the close button (or give another way out).
   */
  size?: SheetSize;
  /** Hide the × close button (Escape still closes). */
  hideClose?: boolean;
  /** Element to focus when opened (default: first focusable). */
  initialFocus?: BaseDialog.Popup.Props["initialFocus"];
  /** Element to focus when closed (default: the trigger). */
  finalFocus?: BaseDialog.Popup.Props["finalFocus"];
  className?: string;
  children?: ReactNode;
};

export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  trigger,
  footer,
  side = "right",
  size = "md",
  hideClose,
  initialFocus,
  finalFocus,
  className,
  children,
}: SheetProps) {
  return (
    <BaseDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Popup
          className={cx(styles.popup, className)}
          data-side={side}
          data-size={size}
          data-closable={hideClose ? undefined : ""}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
        >
          <div className={styles.header}>
            <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
            <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>
          </div>
          {children !== undefined && <div className={styles.body}>{children}</div>}
          {footer && <div className={styles.footer}>{footer}</div>}
          {/* Last in DOM order so initial focus lands on the first field, not on ×. */}
          {!hideClose && (
            <BaseDialog.Close render={<IconButton size="sm" icon={<X aria-hidden />} label="Close" className={styles.close} />} />
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** A button that closes the surrounding Sheet. Defaults to the secondary variant; takes Button props. */
export function SheetClose({ variant = "secondary", ...props }: ButtonProps) {
  return <BaseDialog.Close render={<Button variant={variant} {...(props as ButtonProps)} />} />;
}
