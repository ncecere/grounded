import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AdminUser, type AdminUserDetail } from "../lib/api";
import { Shield, UserX, Trash2, Key, X } from "lucide-react";

export function AdminUsers() {
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: api.listUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { isSystemAdmin?: boolean; disabled?: boolean } }) =>
      api.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            View and manage all users in the system.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tenants
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data?.users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{user.email || "No email"}</div>
                  <div className="text-xs text-gray-500 font-mono">{user.id.substring(0, 8)}...</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isDisabled ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">
                      <UserX className="w-3 h-3" />
                      Disabled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isSystemAdmin ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded">
                      <Shield className="w-3 h-3" />
                      System Admin
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                      User
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.tenantCount}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="text-blue-600 hover:text-blue-800"
                      title="View details"
                    >
                      View
                    </button>
                    <button
                      onClick={() => {
                        setSelectedUser(user);
                        setIsResetPasswordModalOpen(true);
                      }}
                      className="text-gray-600 hover:text-gray-800"
                      title="Reset password"
                    >
                      <Key className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        updateMutation.mutate({
                          id: user.id,
                          data: { isSystemAdmin: !user.isSystemAdmin },
                        });
                      }}
                      className={user.isSystemAdmin ? "text-purple-600 hover:text-purple-800" : "text-gray-400 hover:text-purple-600"}
                      title={user.isSystemAdmin ? "Remove admin" : "Make admin"}
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        updateMutation.mutate({
                          id: user.id,
                          data: { disabled: !user.isDisabled },
                        });
                      }}
                      className={user.isDisabled ? "text-green-600 hover:text-green-800" : "text-orange-600 hover:text-orange-800"}
                      title={user.isDisabled ? "Enable user" : "Disable user"}
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete user "${user.email}"? This cannot be undone.`)) {
                          deleteMutation.mutate(user.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-800"
                      title="Delete user"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(!data?.users || data.users.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <CreateUserModal
          onClose={() => setIsCreateModalOpen(false)}
        />
      )}

      {/* User Detail Modal */}
      {selectedUser && !isResetPasswordModalOpen && (
        <UserDetailModal
          userId={selectedUser.id}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {/* Reset Password Modal */}
      {selectedUser && isResetPasswordModalOpen && (
        <ResetPasswordModal
          user={selectedUser}
          onClose={() => {
            setIsResetPasswordModalOpen(false);
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create New User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="user@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password (optional)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Leave blank for no password"
            />
            <p className="mt-1 text-xs text-gray-500">
              If left blank, the user will need to use OIDC or have their password set later.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isSystemAdmin"
              checked={isSystemAdmin}
              onChange={(e) => setIsSystemAdmin(e.target.checked)}
              className="rounded border-gray-300"
            />
            <label htmlFor="isSystemAdmin" className="text-sm text-gray-700">
              Make System Administrator
            </label>
          </div>

          {createMutation.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !email}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data: user, isLoading } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api.getUser(userId),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">User Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-gray-200 rounded w-3/4"></div>
            <div className="h-5 bg-gray-200 rounded w-1/2"></div>
          </div>
        ) : user ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Email</label>
              <p className="text-sm text-gray-900">{user.email || "No email"}</p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">User ID</label>
              <p className="text-sm text-gray-900 font-mono">{user.id}</p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Created</label>
              <p className="text-sm text-gray-900">{new Date(user.createdAt).toLocaleString()}</p>
            </div>

            <div className="flex gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">System Admin</label>
                <p className="text-sm">
                  {user.isSystemAdmin ? (
                    <span className="text-purple-600">Yes</span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">Status</label>
                <p className="text-sm">
                  {user.isDisabled ? (
                    <span className="text-red-600">Disabled</span>
                  ) : (
                    <span className="text-green-600">Active</span>
                  )}
                </p>
              </div>
            </div>

            {user.tenants && user.tenants.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  Tenant Memberships ({user.tenants.length})
                </label>
                <div className="space-y-2">
                  {user.tenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-900">{tenant.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({tenant.slug})</span>
                      </div>
                      <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded">
                        {tenant.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500">User not found</p>
        )}

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    mutationFn: (newPassword: string) => api.resetUserPassword(user.id, newPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetMutation.mutate(newPassword);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Reset Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Reset password for <strong>{user.email}</strong>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Enter new password"
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be at least 8 characters.
            </p>
          </div>

          {resetMutation.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{resetMutation.error.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={resetMutation.isPending || !newPassword}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {resetMutation.isPending ? "Resetting..." : "Reset Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
