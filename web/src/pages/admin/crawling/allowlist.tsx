import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus } from "lucide-react";
import { useId, useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { formatDate } from "@/lib/format";
import { useIntent } from "@/lib/intents";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field, Form } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, TableActions, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { validateHostPattern } from "../../team/domains";

type AllowlistEntry = Schemas["AllowlistEntry"];

const allowlistKey = ["admin", "crawl-allowlist"];

/* ---------------- allowlist ---------------- */

export function AllowlistCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const entries = useQuery({ queryKey: allowlistKey, queryFn: async () => unwrap(await api.GET("/v1/admin/crawl-allowlist")) });
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
  const list = entries.data ?? [];

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
      flush
    >
      {entries.isLoading ? (
        <Loading label="Loading the allowlist…" />
      ) : entries.error ? (
        <div className={s.pad}>
          <ErrorAlert error={entries.error} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState size="compact" icon={<Globe />} title="The allowlist is empty." description="Teams can only crawl domains approved for them." />
      ) : (
        <Table caption="Crawl allowlist" columns={["Host pattern", "Note", "Added", ""]}>
          {list.map((e) => (
            <Tr key={e.id}>
              <Td>
                <code className={`${s.mono} ${s.primary}`}>{e.pattern}</code>
                {e.pattern === "*" && <span className={s.secondary}>Every public host</span>}
              </Td>
              <Td muted>{e.note || "—"}</Td>
              <Td muted nowrap>
                {formatDate(e.createdAt)}
              </Td>
              <Td>
                <TableActions>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" aria-label={`Remove ${e.pattern}`} onClick={() => setRemoving(e)}>
                      Remove
                    </Button>
                  )}
                </TableActions>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
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
  const patternError = validateHostPattern(form.pattern, { allowStar: true });
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/admin/crawl-allowlist", { body: { pattern: form.pattern.trim().toLowerCase(), note: form.note.trim() || undefined } })),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: allowlistKey });
      toast.success(`${e.pattern} was added to the allowlist`);
      onClose();
    },
  });
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
          if (!patternError) add.mutate();
        }}
      >
        <Field
          label="Host pattern"
          description="*.example.edu allows example.edu and every subdomain. example.org allows only that host. * allows every public host."
          error={submitted ? patternError : undefined}
        >
          <Input
            aria-required
            autoComplete="off"
            spellCheck={false}
            placeholder="*.example.edu"
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          />
        </Field>
        {form.pattern.trim() === "*" && (
          <Alert tone="warning" title="This allows every public host">
            Teams could crawl any site on the internet. Internal and private addresses stay blocked.
          </Alert>
        )}
        <Field label="Note" labelHint="Optional" description="Why this pattern is allowed. Up to 500 characters.">
          <Textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <ErrorAlert error={add.error} />
      </Form>
    </Dialog>
  );
}
