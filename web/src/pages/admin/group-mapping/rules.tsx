/*
 * The group mapping rules as a list: every rule on Admin → Group mapping, or
 * one team's on its admin page. Platform admins change and delete them
 * (each with a dry run); auditors read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Network, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { roleLabels } from "@/components/roles";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { RulePreview } from "./preview";
import { groupRulesQuery, groupRulesRoot, type GroupRule } from "./queries";
import { RuleDialog } from "./rule-dialog";
import g from "./group-mapping.module.css";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function columns(showTeam: boolean): DataTableColumn<GroupRule>[] {
  const cols: DataTableColumn<GroupRule>[] = [
    {
      id: "group",
      header: "IdP group",
      accessor: "group",
      sortable: true,
      rowHeader: true,
      hideable: false,
      cell: (r) => <span className={g.group}>{r.group}</span>,
    },
    {
      id: "team",
      header: "Team",
      accessor: (r) => r.team.name,
      sortable: true,
      cell: (r) => (
        <CellText
          primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: r.team.slug }} search={{ tab: "group-mapping" }} />}>{r.team.name}</TextLink>}
          secondary={r.teamStatus === "archived" ? "Archived: the rule is ignored" : undefined}
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      accessor: (r) => roleLabels[r.role],
      sortable: true,
      cell: (r) => <Badge tone={r.role === "owner" ? "info" : "neutral"}>{roleLabels[r.role]}</Badge>,
    },
    {
      id: "members",
      header: "Members",
      accessor: "memberCount",
      numeric: true,
      sortable: true,
    },
    {
      ...timeColumn<GroupRule>("updatedAt", "Changed", (r) => r.updatedAt),
      defaultHidden: true,
    },
  ];
  return showTeam ? cols : cols.filter((c) => c.id !== "team");
}

type Props = {
  /** Only this team's rules (its slug and name); all rules without it. */
  team?: { slug: string; name: string };
  isAdmin: boolean;
  title?: string;
  description?: ReactNode;
  notices?: ReactNode;
};

export function RuleList({ team, isAdmin, title, description, notices }: Props) {
  const qc = useQueryClient();
  const rules = useQuery(groupRulesQuery(team?.slug));
  const [editing, setEditing] = useState<GroupRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<GroupRule | null>(null);
  const remove = useMutation({
    mutationFn: async (r: GroupRule) =>
      unwrap(
        await api.DELETE("/v1/admin/group-mapping/rules/{ruleId}", {
          params: { path: { ruleId: r.id } },
        }),
      ),
    onSuccess: (_, r) => {
      setDeleting(null);
      toast.success("Rule deleted", `${r.group} → ${r.team.name}`);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: groupRulesRoot });
      void qc.invalidateQueries({ queryKey: ["admin", "team"] });
    },
  });
  const addButton = isAdmin ? <AddRuleButton onClick={() => setEditing("new")} /> : undefined;
  const list = (
    <ListPage<GroupRule>
      id={team ? "admin-team-group-rules" : "admin-group-rules"}
      title={title}
      description={description}
      notices={
        isAdmin ? (
          notices
        ) : (
          <>
            <Alert tone="info" title="Read-only">
              You can view the rules. Only platform admins can add, change or delete them.
            </Alert>
            {notices}
          </>
        )
      }
      primaryAction={addButton}
      caption={team ? `Group mapping rules for ${team.name}` : "Group mapping rules"}
      columns={columns(!team)}
      data={rules.data ?? []}
      getRowId={(r) => r.id}
      rowLabel={(r) => `${r.group} → ${r.team.name}`}
      search={team ? undefined : { label: "Search rules", placeholder: "Group or team" }}
      loading={rules.isLoading}
      error={rules.error}
      onRetry={() => void rules.refetch()}
      rowActions={
        isAdmin
          ? (r) => [
              {
                label: "Change rule…",
                icon: <Pencil aria-hidden />,
                onSelect: () => setEditing(r),
              },
              {
                label: "Delete rule…",
                icon: <Trash2 aria-hidden />,
                danger: true,
                onSelect: () => setDeleting(r),
              },
            ]
          : undefined
      }
      empty={{
        icon: <Network />,
        title: "No group mapping rules.",
        description: "Group mapping is off until a rule exists. Members are added by hand or by invite.",
        action: addButton,
      }}
    />
  );
  return (
    <>
      {title === undefined ? (
        <Card title="Group mapping rules" description={description} actions={addButton} flush>
          {list}
        </Card>
      ) : (
        list
      )}
      {editing && <RuleDialog rule={editing === "new" ? undefined : editing} team={team} onClose={() => setEditing(null)} />}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={remove}
        onConfirm={(r) => remove.mutate(r)}
        title={`Delete the rule for ${deleting?.group ?? "this group"}?`}
        description={deleting ? deleteText(deleting) : ""}
        confirmLabel="Delete rule"
      >
        {deleting && <RulePreview body={{ ruleId: deleting.id, delete: true }} />}
      </ConfirmMutationDialog>
    </>
  );
}

/** What deleting a rule does to the memberships it made. */
export function deleteText(r: Pick<GroupRule, "memberCount" | "team">) {
  if (r.memberCount === 0) return `No memberships in ${r.team.name} came from this rule, so deleting it removes nobody.`;
  return (
    `${plural(r.memberCount, "membership", "memberships")} in ${r.team.name} came from this rule. ` +
    `Deleting it removes ${r.memberCount === 1 ? "that person" : "those people"} from the team now; ` +
    "anyone another rule also matches gets that rule's role instead, and the team's last owner is always kept."
  );
}

function AddRuleButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick}>
      <Plus aria-hidden /> Add rule
    </Button>
  );
}
