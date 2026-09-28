"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/bitop-utils";
import styles from "./toast.module.css";

/*
 * Toasts on Base UI Toast with a global manager, so toasts can be raised from
 * anywhere (mutation callbacks, plain functions):
 *
 *   <Toaster />                       // once, near the app root
 *   toast.success("Source created");  // anywhere
 *   const t = useToast(); t.add({ title: "Saved", tone: "success" });
 *
 * The viewport is a polite live region labelled "Notifications" (F6 jumps
 * into it). Danger toasts use Base UI's high priority, which is announced
 * assertively.
 */

const manager = BaseToast.createToastManager();

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  /** Auto-dismiss after ms (default 5000; 0 keeps it open). */
  timeout?: number;
  /** A single action button, e.g. Undo. */
  action?: { label: string; onClick: () => void };
};

function add({ title, description, tone = "neutral", timeout, action }: ToastOptions): string {
  return manager.add({
    title,
    description,
    type: tone,
    timeout,
    priority: tone === "danger" ? "high" : "low",
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  });
}

export const toast = {
  add,
  success: (title: ReactNode, description?: ReactNode) => add({ title, description, tone: "success" }),
  error: (title: ReactNode, description?: ReactNode) => add({ title, description, tone: "danger" }),
  info: (title: ReactNode, description?: ReactNode) => add({ title, description, tone: "info" }),
  warning: (title: ReactNode, description?: ReactNode) => add({ title, description, tone: "warning" }),
  close: (id?: string) => manager.close(id),
  promise: manager.promise,
};

export type ToastApi = typeof toast;

/** Returns the toast API. (The manager is global; this hook exists for ergonomics.) */
export function useToast(): ToastApi {
  return toast;
}

const icons: Record<Tone, typeof Info | null> = {
  neutral: null,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((t) => {
    const tone = ((t.type as Tone | undefined) ?? "neutral") as Tone;
    const Icon = icons[tone] ?? null;
    return (
      <BaseToast.Root key={t.id} toast={t} className={styles.toast} data-tone={tone}>
        <BaseToast.Content className={styles.content}>
          {Icon && <Icon aria-hidden className={styles.icon} />}
          <div className={styles.text}>
            <BaseToast.Title className={styles.title} />
            <BaseToast.Description className={styles.description} />
          </div>
          {t.actionProps && <BaseToast.Action className={styles.action} />}
          <BaseToast.Close className={styles.close} aria-label="Dismiss notification">
            <X aria-hidden />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}

export type ToastPosition = "bottom-right" | "bottom-center" | "bottom-left";

export type ToasterProps = {
  /** Max visible toasts (default 3). */
  limit?: number;
  /**
   * Where toasts appear (default "bottom-right"). "bottom-center" keeps them
   * clear of right-aligned page actions and sticky save bars. "bottom-left"
   * sits over an AppShell sidebar's footer (sidebar-wide on screens wide
   * enough for a sidebar), so toasts cover navigation, not page content.
   */
  position?: ToastPosition;
};

/** Renders the toast viewport. Mount once. */
export function Toaster({ limit = 3, position = "bottom-right" }: ToasterProps) {
  return (
    <BaseToast.Provider toastManager={manager} limit={limit}>
      <BaseToast.Portal>
        <BaseToast.Viewport className={styles.viewport} data-position={position}>
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
