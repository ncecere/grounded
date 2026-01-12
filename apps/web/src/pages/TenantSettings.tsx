import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TenantAlertSettings, type TenantApiKey, type TenantApiKeyWithSecret, getCurrentTenantId } from "../lib/api";
import { Key, Trash2, X, Copy, Check, Clock, AlertTriangle } from "lucide-react";

type SettingsTab = "members" | "alerts" | "api-keys";

export function TenantSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("members");
  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-gray-500">No tenant selected. Please select a tenant first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your team members and notification preferences.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab("members")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "members"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Team Members
        </button>
        <button
          onClick={() => setActiveTab("alerts")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "alerts"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Alert Settings
        </button>
        <button
          onClick={() => setActiveTab("api-keys")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "api-keys"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          API Keys
        </button>
      </div>

      {activeTab === "members" && <MembersTab tenantId={tenantId} />}
      {activeTab === "alerts" && <AlertSettingsTab tenantId={tenantId} />}
      {activeTab === "api-keys" && <ApiKeysTab tenantId={tenantId} />}
    </div>
  );
}

function MembersTab({ tenantId }: { tenantId: string }) {
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
    },
  });

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (addEmail) {
      addMemberMutation.mutate({ email: addEmail, role: addRole });
    }
  };

  return (
    <div className="space-y-6">
      {/* Add Member Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Team Member</h2>
        <form onSubmit={handleAddMember} className="flex gap-3">
          <input
            type="email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="user@example.com"
          />
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            disabled={!addEmail || addMemberMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {addMemberMutation.isPending ? "Adding..." : "Add Member"}
          </button>
        </form>
        {addMemberMutation.error && (
          <p className="mt-2 text-sm text-red-600">{addMemberMutation.error.message}</p>
        )}
      </div>

      {/* Members List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
        </div>
        {isLoading ? (
          <div className="p-6 animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-gray-200 rounded"></div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {membersData?.members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{member.email}</p>
                  <p className="text-xs text-gray-500">
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
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${member.email} from this team?`)) {
                        removeMemberMutation.mutate(member.userId);
                      }
                    }}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {(!membersData?.members || membersData.members.length === 0) && (
              <div className="px-6 py-12 text-center text-gray-500">
                No team members yet. Add someone to get started.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertSettingsTab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-alert-settings", tenantId],
    queryFn: () => api.getTenantAlertSettings(tenantId),
  });

  const updateMutation = useMutation({
    mutationFn: (settings: Partial<Omit<TenantAlertSettings, "tenantId" | "createdAt" | "updatedAt">>) =>
      api.updateTenantAlertSettings(tenantId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-alert-settings", tenantId] });
    },
  });

  const [localSettings, setLocalSettings] = useState<Partial<TenantAlertSettings>>({});

  const settings = data?.alertSettings;

  const handleChange = <K extends keyof TenantAlertSettings>(
    key: K,
    value: TenantAlertSettings[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate(localSettings);
    setLocalSettings({});
  };

  const hasChanges = Object.keys(localSettings).length > 0;

  const getValue = <K extends keyof TenantAlertSettings>(key: K): TenantAlertSettings[K] | undefined => {
    if (key in localSettings) {
      return localSettings[key] as TenantAlertSettings[K];
    }
    return settings?.[key];
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          Configure health alert notifications for your tenant. When issues are detected (high error rates,
          quota warnings, etc.), team members will receive email alerts based on these settings.
        </p>
      </div>

      {/* Enable/Disable Alerts */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enable Alerts</h2>
            <p className="text-sm text-gray-500">Receive health alerts for this tenant</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={getValue("enabled") ?? true}
              onChange={(e) => handleChange("enabled", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      {/* Notification Recipients */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Notification Recipients</h2>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-gray-900">Notify Owners</p>
            <p className="text-xs text-gray-500">All tenant owners will receive alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={getValue("notifyOwners") ?? true}
              onChange={(e) => handleChange("notifyOwners", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-2 border-t border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-900">Notify Admins</p>
            <p className="text-xs text-gray-500">All tenant admins will receive alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={getValue("notifyAdmins") ?? false}
              onChange={(e) => handleChange("notifyAdmins", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <label className="block text-sm font-medium text-gray-900 mb-1">Additional Emails</label>
          <input
            type="text"
            value={getValue("additionalEmails") || ""}
            onChange={(e) => handleChange("additionalEmails", e.target.value || null)}
            placeholder="email1@example.com, email2@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Comma-separated list of additional email addresses to notify</p>
        </div>
      </div>

      {/* Threshold Overrides */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Alert Thresholds</h2>
          <p className="text-sm text-gray-500">Customize when alerts are triggered. Leave empty to use system defaults.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Error Rate Threshold (%)</label>
            <input
              type="number"
              value={getValue("errorRateThreshold") ?? ""}
              onChange={(e) =>
                handleChange("errorRateThreshold", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="10 (default)"
              min="1"
              max="100"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Alert when error rate exceeds this %</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Quota Warning (%)</label>
            <input
              type="number"
              value={getValue("quotaWarningThreshold") ?? ""}
              onChange={(e) =>
                handleChange("quotaWarningThreshold", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="80 (default)"
              min="1"
              max="100"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Alert when quota usage exceeds this %</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Inactivity Warning (days)</label>
            <input
              type="number"
              value={getValue("inactivityDays") ?? ""}
              onChange={(e) =>
                handleChange("inactivityDays", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="7 (default)"
              min="0"
              max="365"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Alert after this many days of no activity (0 to disable)</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setLocalSettings({})}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {updateMutation.isSuccess && !hasChanges && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">Alert settings saved successfully!</p>
        </div>
      )}

      {updateMutation.error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{updateMutation.error.message}</p>
        </div>
      )}
    </div>
  );
}

function ApiKeysTab({ tenantId }: { tenantId: string }) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newKey, setNewKey] = useState<TenantApiKeyWithSecret | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-api-keys", tenantId],
    queryFn: () => api.listTenantApiKeys(tenantId),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.revokeTenantApiKey(tenantId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-api-keys", tenantId] });
    },
  });

  const handleKeyCreated = (key: TenantApiKeyWithSecret) => {
    setNewKey(key);
    setIsCreateModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["tenant-api-keys", tenantId] });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48"></div>
        <div className="h-64 bg-gray-200 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
          <p className="text-sm text-gray-500">Manage API keys for programmatic access to this tenant.</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create API Key
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Key className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-blue-900">Using API Keys</h3>
            <p className="text-sm text-blue-700 mt-1">
              API keys allow programmatic access to your tenant's resources. Use them with the Authorization header:
            </p>
            <code className="block mt-2 text-xs bg-blue-100 text-blue-800 p-2 rounded font-mono">
              Authorization: Bearer grounded_...
            </code>
          </div>
        </div>
      </div>

      {/* Keys Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Key Prefix
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Scopes
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Expires
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data?.apiKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                onRevoke={() => {
                  if (confirm(`Revoke API key "${key.name}"? This cannot be undone.`)) {
                    revokeMutation.mutate(key.id);
                  }
                }}
              />
            ))}
            {(!data?.apiKeys || data.apiKeys.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No API keys found. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Key Modal */}
      {isCreateModalOpen && (
        <CreateApiKeyModal
          tenantId={tenantId}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleKeyCreated}
        />
      )}

      {/* New Key Display Modal */}
      {newKey && (
        <NewApiKeyModal
          apiKey={newKey}
          onClose={() => setNewKey(null)}
        />
      )}
    </div>
  );
}

function ApiKeyRow({ apiKey, onRevoke }: { apiKey: TenantApiKey; onRevoke: () => void }) {
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date();

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-900">{apiKey.name}</span>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <code className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded">
          {apiKey.keyPrefix}...
        </code>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex gap-1">
          {apiKey.scopes.map((scope) => (
            <span key={scope} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {scope}
            </span>
          ))}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {apiKey.lastUsedAt ? (
          new Date(apiKey.lastUsedAt).toLocaleDateString()
        ) : (
          <span className="text-gray-400">Never</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        {apiKey.expiresAt ? (
          <div className="flex items-center gap-1">
            {isExpired ? (
              <>
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Expired</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {new Date(apiKey.expiresAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-sm text-gray-400">Never</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <button
          onClick={onRevoke}
          className="text-red-600 hover:text-red-800 p-1"
          title="Revoke key"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

function CreateApiKeyModal({
  tenantId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  onClose: () => void;
  onCreated: (key: TenantApiKeyWithSecret) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["chat", "read"]);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes?: string[]; expiresAt?: string }) =>
      api.createTenantApiKey(tenantId, data),
    onSuccess: (data) => {
      onCreated(data);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      scopes,
      expiresAt: hasExpiry && expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
  };

  const toggleScope = (scope: string) => {
    if (scopes.includes(scope)) {
      setScopes(scopes.filter((s) => s !== scope));
    } else {
      setScopes([...scopes, scope]);
    }
  };

  // Default to 1 year from now for expiry input
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
  const defaultExpiryStr = defaultExpiry.toISOString().split("T")[0];

  return (
    <div className="fixed inset-0 overlay-dim backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create API Key</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Key Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="e.g., Production API"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Scopes
            </label>
            <div className="flex gap-3">
              {["chat", "read", "write"].map((scope) => (
                <label key={scope} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 capitalize">{scope}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Chat allows chat API access. Read allows reading KBs and agents. Write allows modifications.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="hasExpiry"
                checked={hasExpiry}
                onChange={(e) => setHasExpiry(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="hasExpiry" className="text-sm text-gray-700">
                Set expiration date
              </label>
            </div>
            {hasExpiry && (
              <input
                type="date"
                value={expiresAt || defaultExpiryStr}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              />
            )}
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
              disabled={createMutation.isPending || !name || scopes.length === 0}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create Key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewApiKeyModal({
  apiKey,
  onClose,
}: {
  apiKey: TenantApiKeyWithSecret;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 overlay-dim backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Key Created</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-amber-900">Copy your API key now</h3>
              <p className="text-sm text-amber-700 mt-1">
                This is the only time you'll see this key. Store it securely - you won't be able to see it again.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Key Name
            </label>
            <p className="text-sm text-gray-900">{apiKey.name}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-gray-100 text-gray-900 px-3 py-2 rounded-lg break-all">
                {apiKey.apiKey}
              </code>
              <button
                onClick={handleCopy}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scopes
            </label>
            <div className="flex gap-2">
              {apiKey.scopes.map((scope) => (
                <span key={scope} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  {scope}
                </span>
              ))}
            </div>
          </div>

          {apiKey.expiresAt && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expires
              </label>
              <p className="text-sm text-gray-600">
                {new Date(apiKey.expiresAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
