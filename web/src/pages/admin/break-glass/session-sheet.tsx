/*
 * One break-glass session (?record=): who, which team, why, the scope and
 * times, what it read (counts by kind and the read log, never content) and
 * the actions the viewer may take: approve or deny (another admin), end
 * (the reader, or another admin revoking it) or withdraw a request.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LoadMore } from "@/components/query-view";
import { RecordSheet } from "@/components/templates/record-sheet";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { type BreakGlassDetail, durationText, personName, readKindLabels, scopeWords, statusLabels, statusTone } from "@/lib/break-glass";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import b from "./break-glass.module.css";
import { useReads, useSession, useSessionAction } from "./queries";

/** Open while waiting or reading: a platform admin may act on it (the footer). */
const actionable = (v: BreakGlassDetail) => v.status === "pending" || (v.status === "active" && Boolean(v.expiresAt) && new Date(v.expiresAt!).getTime() > Date.now());

export function SessionSheet({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const q = useSession(id);
  const v = q.data;
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  return (
    <RecordSheet
      open={Boolean(id)}
      onClose={onClose}
      title={v ? `Break-glass: ${v.team.name}` : "Break-glass session"}
      description={v ? `${personName(v.requestedBy)} asked to read the ${scopeWords(v.scopes)}.` : "A break-glass session."}
      loading={q.isLoading}
      error={q.error}
      facts={v ? facts(v) : undefined}
      sections={
        v
          ? [
              { title: "Reason", content: <p className={b.text}>{v.reason}</p> },
              { title: "What was read", content: <ReadCounts session={v} /> },
              { title: "Read log", content: <ReadLog id={v.id} /> },
            ]
          : undefined
      }
      footer={v && isAdmin && actionable(v) ? <SessionActions session={v} /> : undefined}
    />
  );
}

function facts(v: BreakGlassDetail) {
  return [
    { label: "Status", value: <StatusBadge tone={statusTone[v.status]}>{statusLabels[v.status]}</StatusBadge> },
    { label: "Team", value: <TextLink render={<Link to="/admin/teams/$team" params={{ team: v.team.slug }} />}>{v.team.name}</TextLink> },
    { label: "Admin", value: `${personName(v.requestedBy)} (${v.requestedBy.email})` },
    { label: "Scope", value: scopeWords(v.scopes) },
    { label: "Duration", value: durationText(v.durationMinutes) },
    { label: "Requested", value: formatDate(v.requestedAt) },
    ...(v.approvalDeadline ? [{ label: "Lapses", value: formatDate(v.approvalDeadline) }] : []),
    ...(v.decidedBy ? [{ label: v.status === "denied" ? "Denied by" : "Approved by", value: `${personName(v.decidedBy)}, ${formatDate(v.decidedAt)}` }] : []),
    ...(v.decisionNote ? [{ label: "Denial reason", value: v.decisionNote }] : []),
    ...(v.startedAt ? [{ label: "Started", value: formatDate(v.startedAt) }] : []),
    ...(v.expiresAt ? [{ label: v.status === "active" ? "Ends" : "Planned end", value: formatDate(v.expiresAt) }] : []),
    ...(v.endedAt && v.status !== "active" ? [{ label: "Ended", value: `${formatDate(v.endedAt)}${v.endedBy ? `, by ${personName(v.endedBy)}` : ""}` }] : []),
  ];
}

function ReadCounts({ session: v }: { session: BreakGlassDetail }) {
  if (v.reads.length === 0) return <p className={s.muted}>Nothing was read.</p>;
  return (
    <Table caption="Reads by kind" columns={["Kind", "Things read", "Reads"]}>
      {v.reads.map((r) => (
        <Tr key={r.kind}>
          <Td>{readKindLabels[r.kind]}</Td>
          <Td>{r.targets}</Td>
          <Td>{r.reads}</Td>
        </Tr>
      ))}
    </Table>
  );
}

function ReadLog({ id }: { id: string }) {
  const q = useReads(id);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) return <p className={s.muted}>Loading the read log…</p>;
  if (items.length === 0) return <p className={s.muted}>No reads.</p>;
  return (
    <>
      <Table caption="Read log, newest first" columns={["When", "What", "Target"]}>
        {items.map((r) => (
          <Tr key={r.id}>
            <Td>{formatDate(r.occurredAt)}</Td>
            <Td>{readKindLabels[r.kind]}</Td>
            <Td>
              {r.targetLabel || (r.targetType === "conversation" ? "A conversation" : r.targetType === "team" ? "The team" : "—")}
              <span className={`${s.secondary} ${s.mono}`}>{r.targetId}</span>
            </Td>
          </Tr>
        ))}
      </Table>
      <LoadMore query={q} />
    </>
  );
}

function SessionActions({ session: v }: { session: BreakGlassDetail }) {
  const me = useCurrentUser();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const act = useSessionAction(v.id, (s) => {
    setDenying(false);
    toast.success(`Session ${statusLabels[s.status].toLowerCase()}`, s.team.name);
  });
  const mine = v.requestedBy.id === me.user.id;
  const live = v.status === "active" && actionable(v);
  return (
    <>
      {v.status === "pending" && !mine && (
        <>
          <Button variant="ghost" onClick={() => setDenying(true)}>
            Deny
          </Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ kind: "approve" })}>
            Approve
          </Button>
        </>
      )}
      {v.status === "pending" && mine && (
        <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ kind: "end" })}>
          Withdraw request
        </Button>
      )}
      {live && mine && v.scopes.includes("conversations") && (
        <Button variant="secondary" render={<Link to="/admin/break-glass/$sessionId/conversations" params={{ sessionId: v.id }} />}>
          Read conversations
        </Button>
      )}
      {live && mine && v.scopes.includes("documents") && (
        <Button variant="secondary" render={<Link to="/teams/$team/sources" params={{ team: v.team.slug }} />}>
          Read documents
        </Button>
      )}
      {live && (
        <Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ kind: "end" })}>
          {mine ? "End now" : "Revoke"}
        </Button>
      )}
      <AlertDialog
        open={denying}
        onOpenChange={(o) => !o && setDenying(false)}
        tone="danger"
        title={`Deny break-glass for ${v.team.name}?`}
        description={`${personName(v.requestedBy)} can't read the team's content. They see your reason.`}
        confirmLabel="Deny request"
        busy={act.isPending}
        error={act.error}
        onConfirm={() => reason.trim() && act.mutate({ kind: "deny", reason: reason.trim() })}
      >
        <Field label="Reason" description="Required. Up to 1,000 characters.">
          <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </AlertDialog>
    </>
  );
}
