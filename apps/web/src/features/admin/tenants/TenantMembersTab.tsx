import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

interface TenantMembersTabProps {
  tenantId: string;
}

export function TenantMembersTab({ tenantId }: TenantMembersTabProps) {
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const queryClient = useQueryClient();

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: () => api.listTenantMembers(tenantId),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.addTenantMember(tenantId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
      setAddEmail("");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateTenantMember(tenantId, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeTenantMember(tenantId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (addEmail) {
      addMemberMutation.mutate({ email: addEmail, role: addRole });
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Member Form */}
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
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button
            type="submit"
            disabled={!addEmail || addMemberMutation.isPending}
          >
            Add
          </Button>
        </div>
        {addMemberMutation.error && (
          <p className="mt-2 text-sm text-destructive">{addMemberMutation.error.message}</p>
        )}
      </form>

      {/* Members List */}
      {isLoading ? (
        <LoadingSkeleton variant="table" count={3} />
      ) : (
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
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button
                  variant="link"
                  onClick={() => {
                    if (confirm(`Remove ${member.email} from this tenant?`)) {
                      removeMemberMutation.mutate(member.userId);
                    }
                  }}
                  className="text-destructive"
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {(!membersData?.members || membersData.members.length === 0) && (
            <p className="text-center text-muted-foreground py-4">No members yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
