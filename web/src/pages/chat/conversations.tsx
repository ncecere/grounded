/*
 * The chat page's conversation list (a full-height panel beside the thread,
 * or a sheet on narrow screens) and each conversation's actions: rename,
 * export and delete.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, MessageSquareOff, MoreHorizontal, Pencil, SquarePen, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { conversationsKey } from "../../api/queries";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button, IconButton } from "@/components/ui/button/button";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field, Form } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { Menu, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu/menu";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { Time } from "@/components/ui/time/time";
import { toast } from "@/components/ui/toast/toast";
import { groupByDay } from "../../lib/group-by-day";
import c from "./chat.module.css";

type Card = Schemas["AgentCard"];
export type ConversationSummary = Schemas["Conversation"];


/** Rename, export and delete a conversation, from a compact "…" menu. */
export function ConversationMenu({ conversation, onDeleted, label }: { conversation: ConversationSummary; onDeleted: () => void; label?: string }) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const title = conversation.title || "Untitled conversation";
  const exportHref = (format: "markdown" | "json") => `/v1/conversations/${conversation.id}/export?format=${format}`;
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/v1/conversations/{conversationId}", { params: { path: { conversationId: conversation.id } } })),
    onSuccess: () => {
      setDeleting(false);
      qc.invalidateQueries({ queryKey: conversationsKey });
      toast.success("Conversation deleted");
      onDeleted();
    },
  });
  return (
    <>
      <Menu align="end" trigger={<IconButton size="sm" icon={<MoreHorizontal aria-hidden />} label={label ?? `Actions for ${title}`} />}>
        <MenuItem icon={<Pencil aria-hidden />} onClick={() => setRenaming(true)}>
          Rename…
        </MenuItem>
        <MenuLinkItem icon={<Download aria-hidden />} href={exportHref("markdown")} download>
          Export as Markdown
        </MenuLinkItem>
        <MenuLinkItem icon={<Download aria-hidden />} href={exportHref("json")} download>
          Export as JSON
        </MenuLinkItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 aria-hidden />} tone="danger" onClick={() => setDeleting(true)}>
          Delete…
        </MenuItem>
      </Menu>
      {renaming && <RenameDialog conversation={conversation} onClose={() => setRenaming(false)} />}
      <AlertDialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) remove.reset();
        }}
        title={`Delete “${title}”?`}
        description="It disappears from your conversations now. The stored copy is removed permanently under the platform's retention policy, or later if records rules require it; until then it's kept but nobody else can read it."
        confirmLabel="Delete conversation"
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function RenameDialog({ conversation, onClose }: { conversation: ConversationSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const [title, setTitle] = useState(conversation.title);
  const rename = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH("/v1/conversations/{conversationId}", { params: { path: { conversationId: conversation.id } }, body: { title: title.trim() } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationsKey });
      toast.success("Conversation renamed");
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title="Rename conversation"
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={rename.isPending} disabled={!title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) rename.mutate();
        }}
      >
        <Field label="Title">
          <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <ErrorAlert error={rename.error} />
      </Form>
    </Dialog>
  );
}

/** A link to a conversation that was deleted or never existed (US-01): one request, then this, with a way to start over. */
export function ConversationGone({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      icon={<MessageSquareOff />}
      titleAs="h2"
      title="This conversation isn't available."
      description="It was deleted, or the link is wrong."
      action={
        <Button variant="secondary" onClick={onNew}>
          <SquarePen aria-hidden /> Start a new chat
        </Button>
      }
    />
  );
}

type ConversationsResult = { isLoading: boolean; error: unknown; data?: { items: ConversationSummary[] } };

type ListProps = {
  card: Card;
  conversations: ConversationsResult;
  selected?: string;
  onNew: () => void;
  /** Called after picking a conversation (closes the sheet on narrow screens). */
  onPick?: () => void;
  className?: string;
};

/** "New conversation" and the user's conversations with the agent, newest first, grouped by day (W11). */
export function ConversationList({ card, conversations, selected, onNew, onPick, className }: ListProps) {
  const items = conversations.data?.items ?? [];
  return (
    <nav aria-label={`Conversations with ${card.name}`} className={className}>
      <Button variant="secondary" block onClick={onNew}>
        <SquarePen aria-hidden /> New conversation
      </Button>
      <h2 className={c.sideTitle}>Your conversations</h2>
      {conversations.isLoading ? (
        <Stack gap={2}>
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
        </Stack>
      ) : conversations.error ? (
        <ErrorAlert error={conversations.error} />
      ) : items.length === 0 ? (
        <p className={c.convEmpty}>No conversations yet.</p>
      ) : (
        <div className={c.convScroll}>
          {groupByDay(items).map((g) => {
            const id = `conv-day-${g.key.replace(/\W/g, "")}`;
            return (
              <section key={g.key} aria-labelledby={id} className={c.convGroup}>
                <h3 id={id} className={c.convDay}>
                  {g.label}
                </h3>
                <ul className={c.convList}>
                  {g.items.map((conv) => (
                    <li key={conv.id} className={c.conv} data-current={conv.id === selected ? "" : undefined}>
                      <Link to="." search={{ c: conv.id }} className={c.convLink} aria-current={conv.id === selected ? "page" : undefined} onClick={onPick}>
                        <span className={c.convTitle}>{conv.title || "Untitled conversation"}</span>
                        <Time value={conv.updatedAt} format="time" className={c.convDate} />
                      </Link>
                      <ConversationMenu conversation={conv} onDeleted={() => conv.id === selected && onNew()} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </nav>
  );
}
