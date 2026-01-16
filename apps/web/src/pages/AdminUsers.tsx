import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AdminUser } from "../lib/api";
import { Shield, UserX, Trash2, Key, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminUsers() {
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: api.listUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setUserToDelete(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { isSystemAdmin?: boolean; disabled?: boolean } }) =>
      api.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const columns: Column<AdminUser>[] = [
    {
      key: "email",
      header: "Email",
      render: (user) => (
        <div>
          <div className="text-sm font-medium text-foreground">{user.email || "No email"}</div>
          <div className="text-xs text-muted-foreground font-mono">{user.id.substring(0, 8)}...</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (user) => (
        <StatusBadge
          status={user.isDisabled ? "error" : "active"}
          label={user.isDisabled ? "Disabled" : "Active"}
        />
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (user) =>
        user.isSystemAdmin ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded">
            <Shield className="w-3 h-3" />
            System Admin
          </span>
        ) : (
          <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
            User
          </span>
        ),
    },
    {
      key: "tenantCount",
      header: "Tenants",
      render: (user) => (
        <span className="text-sm text-muted-foreground">{user.tenantCount}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (user) => (
        <span className="text-sm text-muted-foreground">
          {new Date(user.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (user) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedUser(user);
            }}
          >
            View
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedUser(user);
              setIsResetPasswordModalOpen(true);
            }}
            title="Reset password"
          >
            <Key className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${user.isSystemAdmin ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}
            onClick={(e) => {
              e.stopPropagation();
              updateMutation.mutate({
                id: user.id,
                data: { isSystemAdmin: !user.isSystemAdmin },
              });
            }}
            title={user.isSystemAdmin ? "Remove admin" : "Make admin"}
          >
            <Shield className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${user.isDisabled ? "text-success" : "text-warning"}`}
            onClick={(e) => {
              e.stopPropagation();
              updateMutation.mutate({
                id: user.id,
                data: { disabled: !user.isDisabled },
              });
            }}
            title={user.isDisabled ? "Enable user" : "Disable user"}
          >
            <UserX className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setUserToDelete(user);
            }}
            title="Delete user"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="User Management"
        description="View and manage all users in the system."
        actions={
          <Button onClick={() => setIsCreateModalOpen(true)}>
            Create User
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.users || []}
        getRowKey={(user) => user.id}
        emptyState={{
          icon: Users,
          title: "No users found",
          description: "Get started by creating a new user.",
          action: {
            label: "Create User",
            onClick: () => setIsCreateModalOpen(true),
          },
        }}
      />

      {/* Create User Modal */}
      <CreateUserModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />

      {/* User Detail Modal */}
      {selectedUser && !isResetPasswordModalOpen && (
        <UserDetailModal
          userId={selectedUser.id}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedUser(null);
          }}
        />
      )}

      {/* Reset Password Modal */}
      {selectedUser && isResetPasswordModalOpen && (
        <ResetPasswordModal
          user={selectedUser}
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setIsResetPasswordModalOpen(false);
              setSelectedUser(null);
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!userToDelete}
        onOpenChange={(open) => {
          if (!open) setUserToDelete(null);
        }}
        title="Delete User"
        description={`Are you sure you want to delete "${userToDelete?.email}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (userToDelete) {
            deleteMutation.mutate(userToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function CreateUserModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onOpenChange(false);
      setEmail("");
      setPassword("");
      setIsSystemAdmin(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      email,
      password: password || undefined,
      isSystemAdmin,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password (optional)</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for no password"
            />
            <p className="text-xs text-muted-foreground">
              If left blank, the user will need to use OIDC or have their password set later.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="isSystemAdmin"
              checked={isSystemAdmin}
              onCheckedChange={(checked) => setIsSystemAdmin(checked === true)}
            />
            <Label htmlFor="isSystemAdmin" className="text-sm font-normal">
              Make System Administrator
            </Label>
          </div>

          {createMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{createMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !email}
            >
              {createMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserDetailModal({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: user, isLoading } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api.getUser(userId),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : user ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Email</Label>
              <p className="text-sm text-foreground">{user.email || "No email"}</p>
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">User ID</Label>
              <p className="text-sm text-foreground font-mono">{user.id}</p>
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Created</Label>
              <p className="text-sm text-foreground">{new Date(user.createdAt).toLocaleString()}</p>
            </div>

            <div className="flex gap-6">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">System Admin</Label>
                <p className="text-sm">
                  {user.isSystemAdmin ? (
                    <span className="text-purple-600 dark:text-purple-400">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Status</Label>
                <p className="text-sm">
                  {user.isDisabled ? (
                    <span className="text-destructive">Disabled</span>
                  ) : (
                    <span className="text-success">Active</span>
                  )}
                </p>
              </div>
            </div>

            {user.tenants && user.tenants.length > 0 && (
              <div>
                <Label className="text-xs uppercase text-muted-foreground mb-2 block">
                  Tenant Memberships ({user.tenants.length})
                </Label>
                <div className="space-y-2">
                  {user.tenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                    >
                      <div>
                        <span className="text-sm font-medium text-foreground">{tenant.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({tenant.slug})</span>
                      </div>
                      <span className="text-xs font-medium bg-background text-muted-foreground px-2 py-1 rounded">
                        {tenant.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">User not found</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordModal({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    mutationFn: (newPassword: string) => api.resetUserPassword(user.id, newPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onOpenChange(false);
      setNewPassword("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetMutation.mutate(newPassword);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Reset password for <strong>{user.email}</strong>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">
              Must be at least 8 characters.
            </p>
          </div>

          {resetMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{resetMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={resetMutation.isPending || !newPassword}
            >
              {resetMutation.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
