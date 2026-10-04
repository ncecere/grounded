/*
 * The team's members (Team settings › Members): a data table with each
 * person's role (a select when the viewer may change it), and Leave / Remove
 * in the row's "…" menu (D5). The only owner gets no role select, with the
 * reason shown. A search box appears once the team has more than 20 members.
 * Members an SSO group mapping rule manages say so, and can't be changed or
 * removed by hand: the next sign-in would undo it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "../api/client";
import s from "../pages/shared.module.css";
import { ConfirmMutationDialog } from "./confirm-dialog";
import { leaveBlockedReason, membersKey } from "./members";
import { RoleBadge } from "./role-badge";
import { canManage, roleLabels, teamRoles, type TeamRole } from "./roles";
import { ActionMenu } from "./templates/action-menu";
import { RelativeTime } from "./templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Avatar } from "@/components/ui/avatar/avatar";
import { Badge } from "@/components/ui/badge/badge";
import { type DataTableColumn, DataTable } from "@/components/ui/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { managedBySso } from "@/lib/terms";

type Member = Schemas["Member"];

/** The group of the rule managing this membership, or undefined when it's hand-managed. */
export function ssoGroup(m: Member) {
  return m.managedBy?.ruleId ? (m.managedBy.group ?? "") : undefined;
}

/** Why a managed member can't be changed or removed by hand. */
export const ssoBlockedReason = (m: Member, isMe: boolean) =>
  isMe
    ? `${managedBySso(ssoGroup(m) ?? "")}: you'd be added again at your next sign-in. Ask to be removed from the group in your identity provider.`
    : `${managedBySso(ssoGroup(m) ?? "")}: they'd be added again at their next sign-in. A platform admin can change the group mapping rule.`;

/** Past this many members the list gets a search box. */
export const MEMBER_SEARCH_AT = 20;

/** Change a member's role, and remove a member (or leave the team). */
function useMemberMutations(team: string, myUserId: string, onRemoved: () => void) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team", team] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const changeRole = useMutation({
    mutationFn: async ({ m, role }: { m: Member; role: TeamRole }) =>
      unwrap(await api.PATCH("/v1/teams/{team}/members/{userId}", { params: { path: { team, userId: m.user.id }, header: ifMatch(m.revision) }, body: { role } })),
    onSuccess: (_, { m, role }) => toast.success(`${m.user.displayName} is now ${roleLabels[role].toLowerCase()}`),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (m: Member) => unwrap(await api.DELETE("/v1/teams/{team}/members/{userId}", { params: { path: { team, userId: m.user.id } } })),
    onSuccess: (_, m) => {
      onRemoved();
      if (m.user.id === myUserId) window.location.assign("/");
      else toast.success(`${m.user.displayName} was removed from the team`);
    },
    onSettled: invalidate,
  });
  return { changeRole, remove };
}

/** What the only owner can do about it: SSO-managed members can't be made owners by hand. */
export function soleOwnerHint(list: Member[], owner: Member) {
  const others = list.filter((x) => x.user.id !== owner.user.id);
  if (others.length > 0 && others.every((x) => ssoGroup(x) !== undefined))
    return "The only owner. The other members are managed by SSO group mapping, so add someone as an owner, or ask a platform admin.";
  return "The only owner. Make someone else an owner to change this.";
}

export function MemberList({ team, myRole, myUserId }: { team: string; myRole?: TeamRole; myUserId: string }) {
  const members = useQuery({
    queryKey: membersKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team } } })),
  });
  const [removing, setRemoving] = useState<Member | null>(null);
  const [filter, setFilter] = useState("");
  const { changeRole, remove } = useMemberMutations(team, myUserId, () => setRemoving(null));
  const list = members.data ?? [];
  const owners = list.filter((m) => m.role === "owner").length;
  const leaving = removing?.user.id === myUserId;
  const leaveBlocked = leaveBlockedReason(members.data, myRole);

  const roleCell = (m: Member) => {
    const soleOwner = m.role === "owner" && owners <= 1;
    const group = ssoGroup(m);
    if (soleOwner || group !== undefined || !canManage(myRole, m.role)) {
      return (
        <span>
          <RoleBadge role={m.role} />
          {group !== undefined && <span className={s.secondary}>{managedBySso(group)}</span>}
          {group === undefined && soleOwner && canManage(myRole, m.role) && <span className={s.secondary}>{soleOwnerHint(list, m)}</span>}
        </span>
      );
    }
    return (
      <NativeSelect
        size="sm"
        aria-label={`Role for ${m.user.displayName}`}
        value={m.role}
        disabled={changeRole.isPending}
        onChange={(e) => changeRole.mutate({ m, role: e.target.value as TeamRole })}
        className={s.roleSelect}
      >
        {teamRoles
          .filter((r) => canManage(myRole, m.role, r))
          .map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
      </NativeSelect>
    );
  };

  const columns: DataTableColumn<Member>[] = [
    {
      id: "person",
      header: "Person",
      accessor: (m) => `${m.user.displayName} ${m.user.email}`,
      rowHeader: true,
      cell: (m) => (
        <span className={s.person}>
          <Avatar name={m.user.displayName || m.user.email} size="sm" decorative />
          <span className={s.personText}>
            <span className={s.primary}>
              {m.user.displayName}
              {m.user.id === myUserId && <span className={s.you}>(you)</span>}
            </span>
            <span className={s.secondary}>{m.user.email}</span>
          </span>
          {m.user.status === "suspended" && <Badge tone="danger">Suspended</Badge>}
        </span>
      ),
    },
    { id: "role", header: "Role", accessor: (m) => roleLabels[m.role], cell: roleCell },
    { id: "added", header: "Added", accessor: (m) => new Date(m.createdAt), filterable: false, cell: (m) => <RelativeTime value={m.createdAt} /> },
  ];

  const searchable = list.length > MEMBER_SEARCH_AT;
  return (
    <>
      {changeRole.error ? (
        <div className={s.pad}>
          <ErrorAlert error={changeRole.error} />
        </div>
      ) : null}
      <DataTable<Member>
        caption="Team members"
        // On a phone each member is a block: the person on its own line, the role and date under it (VI2-03).
        stack
        columns={columns}
        data={list}
        getRowId={(m) => m.user.id}
        rowLabel={(m) => m.user.displayName || m.user.email}
        loading={members.isLoading}
        error={members.error}
        onRetry={() => void members.refetch()}
        filterable={searchable}
        filter={searchable ? filter : undefined}
        onFilterChange={setFilter}
        filterLabel="Search members"
        filterPlaceholder="Name or email"
        pageSize={searchable ? 25 : undefined}
        empty={<EmptyState size="compact" icon={<Users />} title="No members yet." />}
        rowActions={(m) => {
          const isMe = m.user.id === myUserId;
          const managed = ssoGroup(m) !== undefined;
          const leaveReason = managed ? ssoBlockedReason(m, true) : leaveBlocked;
          return (
            <ActionMenu
              label={`Actions for ${m.user.displayName || m.user.email}`}
              actions={[
                { label: "Leave team", icon: <LogOut aria-hidden />, danger: true, hidden: !isMe || !myRole, disabled: Boolean(leaveReason), disabledReason: leaveReason, onSelect: () => setRemoving(m) },
                {
                  label: "Remove from team…",
                  icon: <UserMinus aria-hidden />,
                  danger: true,
                  hidden: isMe || !canManage(myRole, m.role),
                  disabled: managed,
                  disabledReason: managed ? ssoBlockedReason(m, false) : undefined,
                  onSelect: () => setRemoving(m),
                },
              ]}
            />
          );
        }}
      />
      <ConfirmMutationDialog
        target={removing}
        onClose={() => setRemoving(null)}
        mutation={remove}
        onConfirm={(m) => remove.mutate(m)}
        title={leaving ? "Leave this team?" : `Remove ${removing?.user.displayName}?`}
        description={leaving ? "You will lose access to this team's sources, knowledge bases and agents." : "They will lose access to this team's sources, knowledge bases and agents."}
        confirmLabel={leaving ? "Leave team" : "Remove"}
      />
    </>
  );
}
