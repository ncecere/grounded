import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, api, unwrap, type Schemas } from "@/api/client";
import { useIntent } from "@/lib/intents";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field, Form } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { validateHostPattern } from "../../team/domains";

type AllowlistEntry = Schemas["AllowlistEntry"];

const allowlistKey = ["admin", "crawl-allowlist"];

export const allowlistQuery = () => ({ queryKey: allowlistKey, queryFn: async () => unwrap(await api.GET("/v1/admin/crawl-allowlist")) });

/* ---------------- allowlist ---------------- */

const columns: DataTableColumn<AllowlistEntry>[] = [
  {
    id: "pattern",
    header: "Host pattern",
    accessor: "pattern",
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (e) => <CellText primary={<code className={s.mono}>{e.pattern}</code>} secondary={e.pattern === "*" ? "Every public host" : undefined} />,
  },
  { id: "note", header: "Note", accessor: (e) => e.note ?? "", muted: true, cell: (e) => e.note || "—" },
  { id: "added", header: "Added", accessor: "createdAt", sortable: true, muted: true, cell: (e) => <RelativeTime value={e.createdAt} /> },
];

/* The allowlist as a list like the others (VI-22): search, Columns, a row count and a row menu. */
export function AllowlistCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const entries = useQuery(allowlistQuery());
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AllowlistEntry | null>(null);
  useIntent("add-allowlist", () => isAdmin && setAdding(true));
  const remove = useMutation({
    mutationFn: async (e: AllowlistEntry) =>
      unwrap(await api.DELETE("/v1/admin/crawl-allowlist/{entryId}", { params: { path: { entryId: e.id } } })),
    onSuccess: (_, e) => {
      setRemoving(null);
      toast.success(`${e.pattern} was removed from the allowlist`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: allowlistKey }),
  });
  return (
    <Card
      title="Crawl allowlist"
      description="Host patterns every team may crawl."
      actions={
        isAdmin && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add pattern
          </Button>
        )
      }
    >
      <ListPage<AllowlistEntry>
        id="admin-crawl-allowlist"
        caption="Crawl allowlist"
        columns={columns}
        data={entries.data ?? []}
        getRowId={(e) => e.id}
        rowLabel={(e) => e.pattern}
        search={{ label: "Search the allowlist", placeholder: "Host or note" }}
        loading={entries.isLoading}
        error={entries.error}
        onRetry={() => void entries.refetch()}
        rowActions={(e) => [{ label: "Remove…", icon: <Trash2 aria-hidden />, danger: true, hidden: !isAdmin, onSelect: () => setRemoving(e) }]}
        empty={{ icon: <Globe />, title: "The allowlist is empty.", description: "Teams can only crawl domains approved for them." }}
      />
      {adding && <AddAllowlistDialog onClose={() => setAdding(false)} />}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title={`Remove ${removing?.pattern ?? "this pattern"}?`}
        description="Crawls of hosts that only this pattern allows stop fetching within 30 seconds, and teams can't create new sources for them. Domains approved for a team through a request stay allowed for that team."
        confirmLabel="Remove pattern"
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

function AddAllowlistDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState({ pattern: "", note: "" });
  const [submitted, setSubmitted] = useState(false);
  // "*" opens crawling of the whole internet to every team: it's confirmed first (AD-08).
  const [confirmStar, setConfirmStar] = useState(false);
  const star = form.pattern.trim() === "*";
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/admin/crawl-allowlist", { body: { pattern: form.pattern.trim().toLowerCase(), note: form.note.trim() || undefined } })),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: allowlistKey });
      toast.success(`${e.pattern} was added to the allowlist`);
      onClose();
    },
  });
  // The server refuses addresses the crawler never fetches (blocked_address) and bad patterns: on the field.
  const fieldError = add.error instanceof ApiError && (add.error.code === "blocked_address" || add.error.code === "invalid_pattern") ? add.error.message : undefined;
  const patternError = validateHostPattern(form.pattern, { allowStar: true });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add an allowlist pattern"
      description="Every team's web sources may crawl matching hosts."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={add.isPending}>
            Add pattern
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (patternError) return;
          if (star) setConfirmStar(true);
          else add.mutate();
        }}
      >
        <Field
          label="Host pattern"
          description="*.example.edu allows example.edu and every subdomain. example.org allows only that host. * allows every public host."
          error={(submitted ? patternError : undefined) ?? fieldError}
        >
          <Input
            aria-required
            autoComplete="off"
            spellCheck={false}
            placeholder="*.example.edu"
            value={form.pattern}
            onChange={(e) => (setForm({ ...form, pattern: e.target.value }), add.reset())}
          />
        </Field>
        {star && (
          <Alert tone="warning" title="This allows every public host">
            Every team could crawl any site on the internet. Private, loopback, link-local and cloud metadata addresses stay blocked.
          </Alert>
        )}
        <Field label="Note" labelHint="Optional" description="Why this pattern is allowed. Up to 500 characters.">
          <Textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        {!fieldError && <ErrorAlert error={add.error} />}
      </Form>
      <AlertDialog
        open={confirmStar}
        onOpenChange={(o) => !o && setConfirmStar(false)}
        title="Allow every public host?"
        description="Every team's web sources could crawl any site on the internet, with no domain request. Private, loopback, link-local and cloud metadata addresses stay blocked."
        confirmLabel="Allow every public host"
        busy={add.isPending}
        error={add.error}
        onConfirm={() => add.mutate(undefined, { onSettled: () => setConfirmStar(false) })}
      />
    </Dialog>
  );
}

