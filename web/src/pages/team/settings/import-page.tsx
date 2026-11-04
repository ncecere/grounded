/*
 * Team settings → Import configuration (D4, docs/specs/config-as-code-import): paste or choose a configuration file, check
 * what it would change, then apply it. Checking writes nothing. Applying makes every change or none, through the same
 * checks as the app; it never deletes, publishes, crawls or turns a webhook on. Editors, admins and owners only.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { csrfHeader, type Schemas } from "../../../api/client";
import sh from "../../shared.module.css";
import { EditorsOnlyState } from "../access";
import { useTeam } from "../common";
import c from "./import-page.module.css";

type Plan = Schemas["ConfigurationPlan"];
type Row = Schemas["ConfigurationPlanRow"];
type Applied = Schemas["ConfigurationApplied"];

const maxBytes = 1 << 20;

export const importDescription =
  "Check what a configuration file would change in this team, then apply it. Nothing is deleted or renamed. New web sources start paused, new agents are drafts and new webhooks are off.";

export function ConfigurationImportPage() {
  const { slug, role } = useTeam();
  if (role === "member") return <EditorsOnlyState title="Import configuration" what="configuration files" />;
  if (role !== "editor" && role !== "admin" && role !== "owner") return <NotFoundState />;
  return (
    <Stack gap={6} className={sh.page}>
      <PageHeader title="Import configuration" description={importDescription} />
      <ImportForm team={slug} />
    </Stack>
  );
}

type Failure = { title: string; message: string };

/** Posts the file (YAML) to plan or apply; the response is the API's JSON envelope. */
async function post(team: string, step: "plan" | "apply", body: string, headers: Record<string, string> = {}) {
  const res = await fetch(`/v1/teams/${encodeURIComponent(team)}/configuration/${step}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/yaml", ...csrfHeader(), ...headers },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { code?: string; message?: string; details?: { plan?: Plan } } };
  return { status: res.status, data: json.data, error: json.error };
}

function ImportForm({ team }: { team: string }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<{ text: string; plan: Plan }>();
  const [applied, setApplied] = useState<Applied>();
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState<"plan" | "apply">();
  // A plan is for the exact text it was made from: any edit asks for a new check before applying.
  const plan = checked && checked.text === text ? checked.plan : undefined;
  const changes = plan ? plan.counts.create + plan.counts.update : 0;
  const canApply = Boolean(plan) && plan!.counts.blocked === 0 && changes > 0 && !busy;

  async function check() {
    setBusy("plan");
    setFailure(undefined);
    setApplied(undefined);
    try {
      const res = await post(team, "plan", text);
      if (res.status === 200) setChecked({ text, plan: res.data as Plan });
      else setFailure({ title: "This file can't be checked", message: res.error?.message ?? `The server answered ${res.status}.` });
    } catch {
      setFailure({ title: "This file can't be checked", message: "The request didn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(undefined);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy("apply");
    setFailure(undefined);
    try {
      const res = await post(team, "apply", text, { "If-Match": `"${plan.planDigest}"` });
      if (res.status === 200) {
        setApplied(res.data as Applied);
        setChecked(undefined);
        await qc.invalidateQueries();
        return;
      }
      const fresh = res.error?.details?.plan;
      if (fresh) setChecked({ text, plan: fresh }); // the team changed: show what applying would do now
      setFailure({
        title: res.status === 412 ? "The team changed since you checked" : "Nothing was applied",
        message: res.status === 412 ? "Review the updated changes below and apply again." : (res.error?.message ?? `The server answered ${res.status}.`),
      });
    } catch {
      setFailure({ title: "Nothing was applied", message: "The request didn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(undefined);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > maxBytes) {
      setFailure({ title: "This file is too large", message: "A configuration file can be at most 1 MiB." });
      return;
    }
    setText(await file.text());
    setFailure(undefined);
  }

  return (
    <>
      <Card title="Configuration file" description="A file exported from Team settings → General, or one kept in version control. Only names, settings and references: never files, passages, conversations or secrets.">
        <Stack gap={4}>
          <Field label="Configuration (YAML)" description="Paste the file, or choose it from your computer.">
            <Textarea className={c.file} rows={14} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className={c.actions}>
            <input ref={fileInput} type="file" accept=".yaml,.yml,application/yaml,text/yaml" hidden onChange={(e) => void choose(e.target.files?.[0])} />
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              <FileUp aria-hidden /> Choose a file…
            </Button>
            <Button type="button" disabled={!text.trim() || Boolean(busy)} onClick={() => void check()}>
              {busy === "plan" ? "Checking…" : "Check changes"}
            </Button>
          </div>
        </Stack>
      </Card>
      <div role="status" className="sr-only">
        {busy === "plan" ? "Checking the file…" : busy === "apply" ? "Applying…" : ""}
      </div>
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.message}
        </Alert>
      )}
      {applied && <AppliedSummary applied={applied} />}
      {checked && !plan && !applied && <Alert tone="info" title="The file changed">Check it again before applying.</Alert>}
      {plan && <PlanView plan={plan} canApply={canApply} applying={busy === "apply"} onApply={() => void apply()} />}
    </>
  );
}

const kindLabels: Record<Row["kind"], string> = { source: "Source", knowledgeBase: "Knowledge base", agent: "Agent", evaluationSet: "Evaluation set", webhook: "Webhook" };
const actionLabels: Record<Row["action"], string> = { create: "Create", update: "Update", "no-op": "No change", "not-in-file": "Not in file" };
const actionTone = (r: Row) => (r.blockers.length ? "danger" : r.action === "create" ? "success" : r.action === "update" ? "info" : "neutral");

function PlanView({ plan, canApply, applying, onApply }: { plan: Plan; canApply: boolean; applying: boolean; onApply: () => void }) {
  const active = plan.rows.filter((r) => r.blockers.length > 0 || r.action === "create" || r.action === "update");
  const quiet = plan.rows.filter((r) => !active.includes(r));
  const { create, update, blocked } = plan.counts;
  return (
    <Card
      title="Changes"
      description={`${create} to create, ${update} to update${blocked ? `, ${blocked} blocked` : ""}. Applying makes every change or none.`}
      actions={
        <Button type="button" disabled={!canApply} onClick={onApply}>
          {applying ? "Applying…" : "Apply changes"}
        </Button>
      }
    >
      <Stack gap={4}>
        {blocked > 0 && (
          <Alert tone="warning" title="Some changes can't be made">
            Fix what each blocked row says, in the file or in the app, then check again.
          </Alert>
        )}
        {active.length === 0 && <p className={c.muted}>The team already matches this file: there is nothing to apply.</p>}
        {active.length > 0 && <RowsTable caption="Changes the file makes" rows={active} />}
        {quiet.length > 0 && (
          <Disclosure title={`${quiet.length} unchanged or not in the file`}>
            <RowsTable caption="Objects that stay as they are" rows={quiet} />
          </Disclosure>
        )}
        {plan.notes.length > 0 && (
          <ul className={c.notes}>
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Stack>
    </Card>
  );
}

function RowsTable({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <Table caption={caption} columns={[{ label: "Object", width: "34%" }, { label: "What happens", width: "14%" }, "Details"]} stack>
      {rows.map((r) => (
        <Tr key={r.kind + r.key}>
          <Td>
            <span className={c.kind}>{kindLabels[r.kind]}</span>
            <span className={c.key}>{r.key}</span>
          </Td>
          <Td>
            <Badge tone={actionTone(r)} size="sm">
              {r.blockers.length ? "Blocked" : actionLabels[r.action]}
            </Badge>
          </Td>
          <Td>
            <RowDetails row={r} />
          </Td>
        </Tr>
      ))}
    </Table>
  );
}

function RowDetails({ row }: { row: Row }) {
  return (
    <div className={c.details}>
      {row.blockers.map((b) => (
        <p key={b} className={c.blocker}>
          {b}
        </p>
      ))}
      {row.changes.length > 0 && (
        <ul className={c.changes}>
          {row.changes.map((ch) => (
            <li key={ch.field}>
              <code>{ch.field}</code>: <span className={c.from}>{ch.from}</span> → <span>{ch.to}</span>
            </li>
          ))}
        </ul>
      )}
      {row.notes.map((n) => (
        <p key={n} className={c.muted}>
          {n}
        </p>
      ))}
    </div>
  );
}

function AppliedSummary({ applied }: { applied: Applied }) {
  const { create, update } = applied.plan.counts;
  return (
    <Alert tone="success" title={create + update ? `Applied: ${create} created, ${update} updated` : "Nothing to apply: the team already matched the file"}>
      <Stack gap={3}>
        <span>New web sources are paused and new agents are drafts: start crawls and publish from their pages when you are ready.</span>
        {applied.webhookSecrets.length > 0 && (
          <>
            <strong>Copy each new webhook's signing secret now: it is shown only once.</strong>
            {applied.webhookSecrets.map((w) => (
              <CopyField key={w.url} label={`Signing secret for ${w.url}`} value={w.secret} />
            ))}
          </>
        )}
      </Stack>
    </Alert>
  );
}
