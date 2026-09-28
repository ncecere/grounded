/*
 * RecordSheet (D4): a leaf record (document, key, domain request, audit
 * entry, crawl run, model, connection, profile) opens in a large side sheet
 * instead of a dialog or a page. The open record is ?record=<id>, so the
 * sheet can be linked to, opening it adds a history entry and Back closes it.
 *
 *   const record = useRecordParam();
 *   <ListPage … onRowClick={(d) => record.open(d.id)} rowActions={(d) => [{ label: "View details", onSelect: () => record.open(d.id) }]} />
 *   <RecordSheet open={!!record.id} onClose={record.close} title={doc?.title ?? "Document"}
 *     description="A document in this source." facts={[{ label: "Status", value: <DocStatus … /> }]}
 *     sections={[{ title: "Passages", content: <PassageList … /> }]}
 *     footer={<><Button variant="danger">Delete</Button><Button>Re-fetch</Button></>}
 *     loading={doc.isLoading} error={doc.error} />
 */
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { type DescriptionEntry, DescriptionList } from "@/components/ui/description-list/description-list";
import { Sheet } from "@/components/ui/sheet/sheet";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { useSearchParams } from "@/lib/url-search";
import { useCloseGuard } from "./close-guard";
import styles from "./templates.module.css";

/** The URL parameter of the open record. */
export const RECORD_PARAM = "record";

/**
 * The open record's id (?record=), `open(id)` (pushes a history entry) and
 * `close()` (goes back when the sheet was opened here, so Back and × agree;
 * otherwise removes the parameter).
 */
export function useRecordParam(param = RECORD_PARAM) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const router = useRouter();
  const id = params.get(param) ?? undefined;
  const open = useCallback(
    (next: string) => {
      setParams(
        (p) => {
          const out = new URLSearchParams(p);
          out.set(param, next);
          return out;
        },
        { replace: false },
      );
      openedHere.add(next);
    },
    [param, setParams],
  );
  const close = useCallback(() => {
    if (id && openedHere.has(id)) {
      openedHere.delete(id);
      // The router's history (the browser's in the app, a memory history in tests).
      router.history.back();
      return;
    }
    void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, [param]: undefined })) as never, replace: true });
  }, [id, navigate, param, router]);
  return { id, open, close };
}

// Records opened by open() in this page session (their history entry is ours to pop).
const openedHere = new Set<string>();

export type RecordSection = { title: ReactNode; content: ReactNode; id?: string };

export type RecordSheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** What the record is; read after the title (required by Sheet). */
  description: ReactNode;
  /** Key facts at the top, as a description list. */
  facts?: DescriptionEntry[];
  /** Titled sections under the facts (Passages, Error, Before/after…). */
  sections?: RecordSection[];
  /** Actions pinned to the bottom (destructive first on the left, the main action last). */
  footer?: ReactNode;
  loading?: boolean;
  error?: unknown;
  /** Extra content after the sections. */
  children?: ReactNode;
  size?: "md" | "lg" | "xl";
  /**
   * The sheet holds unsaved edits (a create or edit form): Escape, the
   * backdrop, × and Cancel ask "Leave without saving?" first (m7).
   */
  dirty?: boolean;
};

export function RecordSheet({ open, onClose, title, description, facts, sections, footer, loading, error, children, size = "lg", dirty = false }: RecordSheetProps) {
  const guard = useCloseGuard(dirty, onClose);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && guard.requestClose()} title={title} description={description} footer={footer} size={size}>
      <div className={styles.record}>
        {Boolean(error) && <ErrorAlert error={error} title="Couldn't load this record" />}
        {loading ? (
          <div role="status" aria-label="Loading…">
            <SkeletonText lines={4} />
          </div>
        ) : (
          <>
            {facts && facts.length > 0 && <DescriptionList items={facts} dividers />}
            {sections?.map((sec, i) => (
              <section key={sec.id ?? i} className={styles.recordSection} aria-label={typeof sec.title === "string" ? sec.title : undefined}>
                <h3 className={styles.recordSectionTitle}>{sec.title}</h3>
                {sec.content}
              </section>
            ))}
            {children}
          </>
        )}
      </div>
      {guard.dialog}
    </Sheet>
  );
}
