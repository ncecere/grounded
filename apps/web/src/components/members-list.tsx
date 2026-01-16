import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface MembersListProps {
  tenantId: string
  /** Whether to show role editing controls */
  canEdit?: boolean
  /** Available roles to choose from */
  roles?: Array<{ value: string; label: string }>
}

const defaultRoles = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
]

export function MembersList({
  tenantId,
  canEdit = true,
  roles = defaultRoles,
}: MembersListProps) {
  const [addEmail, setAddEmail] = useState("")
  const [addRole, setAddRole] = useState<string>("member")
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; email: string } | null>(null)
  const queryClient = useQueryClient()

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: () => api.listTenantMembers(tenantId),
  })

  const addMemberMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.addTenantMember(tenantId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] })
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] })
      setAddEmail("")
    },
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateTenantMember(tenantId, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] })
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeTenantMember(tenantId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] })
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] })
      setMemberToRemove(null)
    },
  })

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault()
    if (addEmail) {
      addMemberMutation.mutate({ email: addEmail, role: addRole })
    }
  }

  if (isLoading) {
    return <LoadingSkeleton variant="table" count={3} />
  }

  return (
    <div className="space-y-4">
      {/* Add Member Form */}
      {canEdit && (
        <form onSubmit={handleAddMember} className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-3">Add Member</h3>
          <div className="flex gap-3">
            <Input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              className="flex-1"
              placeholder="user@example.com"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              disabled={!addEmail || addMemberMutation.isPending}
            >
              {addMemberMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
          {addMemberMutation.error && (
            <p className="mt-2 text-sm text-destructive">{addMemberMutation.error.message}</p>
          )}
        </form>
      )}

      {/* Members List */}
      <div className="space-y-2">
        {membersData?.members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center justify-between p-3 bg-card border border-border rounded-lg"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{member.email}</p>
              <p className="text-xs text-muted-foreground">
                Added {new Date(member.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {canEdit ? (
                <>
                  <select
                    value={member.role}
                    onChange={(e) =>
                      updateRoleMutation.mutate({
                        userId: member.userId,
                        role: e.target.value,
                      })
                    }
                    className="rounded border border-input bg-background px-2 py-1 text-sm"
                  >
                    {roles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="link"
                    onClick={() => setMemberToRemove({ userId: member.userId, email: member.email })}
                    className="text-destructive"
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground capitalize">{member.role}</span>
              )}
            </div>
          </div>
        ))}
        {(!membersData?.members || membersData.members.length === 0) && (
          <p className="text-center text-muted-foreground py-4">No members yet.</p>
        )}
      </div>

      {/* Confirm Remove Dialog */}
      <ConfirmDialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
        title="Remove Member"
        description={`Are you sure you want to remove ${memberToRemove?.email} from this tenant?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => memberToRemove && removeMemberMutation.mutate(memberToRemove.userId)}
        isLoading={removeMemberMutation.isPending}
      />
    </div>
  )
}
