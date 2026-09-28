/*
 * The dry run of a rule change: who it would add, raise, lower or remove,
 * from each person's groups at their last sign-in. Members added by hand and
 * a team's last owner are listed too, as left alone.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { roleLabels } from "@/components/roles";
import { RelativeTime } from "@/components/templates/list-page";
import s from "../../shared.module.css";
import { useDebounced } from "../hooks";
import { changeLabels, changingKinds, groupRulePreviewQuery, summarizeChanges, type GroupRuleChange, type PreviewRequest } from "./queries";
import g from "./group-mapping.module.css";

const tone = (k: GroupRuleChange["kind"]) => (k === "remove" || k === "lower" ? "warning" : changingKinds.includes(k) ? "success" : "neutral");

function roleChange(c: GroupRuleChange) {
  if (c.kind === "add") return c.to ? roleLabels[c.to] : "";
  if (c.kind === "remove") return c.from ? `was ${roleLabels[c.from]}` : "";
  if (c.kind === "manual") return `${c.from ? roleLabels[c.from] : ""}; the rule gives ${c.to ? roleLabels[c.to] : ""}`;
  if (c.kind === "last_owner") return "Owner";
  return `${c.from ? roleLabels[c.from] : ""} → ${c.to ? roleLabels[c.to] : ""}`;
}

/** Runs the dry run for `body` (debounced) while `enabled`. */
export function RulePreview({ body, enabled = true }: { body: PreviewRequest; enabled?: boolean }) {
  const debounced = useDebounced(body, 300);
  const preview = useQuery(groupRulePreviewQuery(debounced, enabled));
  if (!enabled) return null;
  if (preview.isLoading) return <Loading label="Checking who this changes…" />;
  if (preview.error) return <ErrorAlert error={preview.error} title="Couldn't run the dry run" />;
  const changes = preview.data?.changes ?? [];
  return (
    <section className={g.preview} aria-label="Dry run">
      <p className={g.previewSummary}>
        <strong>Dry run:</strong> {summarizeChanges(changes)}.{" "}
        <span className={s.muted}>From the groups each person had at their last sign-in; others are matched when they next sign in.</span>
      </p>
      {changes.length > 0 && (
        <Table caption="People this changes" columns={["Person", "Change", "Role", "Groups seen"]} maxHeight="16rem">
          {changes.map((c) => (
            <Tr key={c.user.id}>
              <Td>
                <span className={s.primary}>{c.user.displayName || c.user.email}</span>
                {c.user.displayName && <span className={s.secondary}>{c.user.email}</span>}
              </Td>
              <Td nowrap>
                <Badge tone={tone(c.kind)}>{changeLabels[c.kind]}</Badge>
              </Td>
              <Td muted>{roleChange(c)}</Td>
              <Td muted nowrap>
                {c.groupsSeenAt ? <RelativeTime value={c.groupsSeenAt} /> : "—"}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </section>
  );
}
