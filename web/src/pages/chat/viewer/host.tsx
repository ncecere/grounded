/*
 * Where the source viewer opens (docs/v0.4.0.md §5, decision 2): a split view
 * beside the conversation, side by side when the chat is wide enough and one
 * above the other in a narrow pane (Try it beside Build's sections); on a
 * phone (and in the widget's small frame) a full-screen sheet with a close
 * button. Never an overlay drawer.
 *
 * The split is always there (one panel while no source is open), so opening
 * a source doesn't remount the conversation and lose its scroll position.
 * Focus goes to the viewer's title when it opens and back to what opened it
 * when it closes.
 */
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable/resizable";
import { Sheet } from "@/components/ui/sheet/sheet";
import type { ChatItem } from "../stream";
import { sourceElementId, sourceTitle } from "../thread";
import { type ViewerAccess, ViewerContext, type ViewerContextValue, type ViewerTarget } from "./data";
import { SourceViewer, viewerCaption } from "./viewer";
import v from "./viewer.module.css";

/** Phones (and small frames such as the widget's) get the full-screen sheet. */
const phoneQuery = "(max-width: 40rem)";
function usePhone() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = globalThis.matchMedia?.(phoneQuery);
      mq?.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    },
    () => globalThis.matchMedia?.(phoneQuery).matches ?? false,
  );
}

/** Side by side from this width of the chat (px); below it, one above the other. Without ResizeObserver (tests), side by side. */
const SIDE_BY_SIDE = 720;
function useWide(el: React.RefObject<HTMLDivElement | null>) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? SIDE_BY_SIDE) >= SIDE_BY_SIDE));
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return wide;
}

type Props = {
  /** How this chat reads cited passages; without it there is no viewer (sources work as before). */
  access?: ViewerAccess;
  /** The chat's items: an open source follows its answer (claims arrive after the text) and closes with it. */
  items: ChatItem[];
  children: ReactNode;
};

export function ViewerHost({ access, items, children }: Props) {
  const [open, setOpen] = useState<{ key: string; n: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const group = useRef<HTMLDivElement | null>(null);
  const phone = usePhone();
  const wide = useWide(group);
  const found = open ? items.find((i) => i.key === open.key && i.role === "assistant") : undefined;
  const item = found?.role === "assistant" ? found : undefined;
  const target: ViewerTarget | undefined = item && open ? { item, n: open.n } : undefined;

  const show = useCallback((t: ViewerTarget) => {
    setOpen((cur) => {
      if (!cur) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return { key: t.item.key, n: t.n };
    });
  }, []);
  const close = useCallback(() => {
    const at = open;
    setOpen(null);
    const back = opener.current;
    opener.current = null;
    // After the panel is gone. What opened it may be gone too (a chip's card closes as it goes): then the source
    // card's own Show source button, so Enter opens it again (mem-10), or the card.
    setTimeout(() => {
      if (back?.isConnected) back.focus();
      else if (at) {
        const card = document.getElementById(sourceElementId(at.key, at.n));
        (card?.querySelector<HTMLElement>("button") ?? card)?.focus();
      }
    }, 0);
  }, [open]);
  // The answer went away (a new chat): close.
  useEffect(() => {
    if (open && !item) setOpen(null);
  }, [open, item]);

  const value = useMemo<ViewerContextValue | null>(() => (access ? { access, target, open: show, close } : null), [access, target, show, close]);
  if (!access || !value) return <>{children}</>;

  const viewer = (bare: boolean) =>
    target && <SourceViewer item={target.item} n={target.n} access={access} onClose={close} onOpen={(n) => show({ item: target.item, n })} bare={bare} />;
  const cited = target?.item.citations.find((s) => s.n === target.n);

  return (
    <ViewerContext.Provider value={value}>
      <ResizablePanelGroup ref={group} orientation={wide ? "horizontal" : "vertical"} className={v.split}>
        <ResizablePanel id="chat-conversation-pane" minSize={30} className={v.chatPane}>
          {children}
        </ResizablePanel>
        {target && !phone && <ResizableHandle withHandle label="Resize the source panel" />}
        {target && !phone && (
          <ResizablePanel id="chat-source-pane" defaultSize={wide ? 42 : 50} minSize={25} className={v.viewerPane}>
            {viewer(false)}
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
      {phone && (
        <Sheet
          open={Boolean(target)}
          onOpenChange={(o) => !o && close()}
          side="bottom"
          size="full"
          title={cited ? sourceTitle(cited) : "Source"}
          description={target ? viewerCaption(target.item, target.n) : ""}
          // Like the side panel: focus on the title, the same close (an arrow back at the start, so it doesn't stack
          // with the widget's own × above it; mem-8, mem-10, aud-6).
          initialFocus="title"
          closeLabel="Close the source"
          closeIcon={<ArrowLeft aria-hidden />}
        >
          {viewer(true)}
        </Sheet>
      )}
    </ViewerContext.Provider>
  );
}
