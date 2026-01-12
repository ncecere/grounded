import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Tenant, type TenantMember, type TenantAlertSettings } from "../lib/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";

export function AdminTenants() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: api.listAllTenants,
  });

  const createMutation = useMutation({
    mutationFn: api.createTenant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
      setIsCreateModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTenant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
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
          <h1 className="text-2xl font-bold text-gray-900">Tenant Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage tenants. Only system administrators can access this page.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Tenant
        </button>
      </div>

      {/* Tenants Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tenant
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Slug
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Members
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
            {data?.tenants.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                  <div className="text-xs text-gray-500">{tenant.id}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                    {tenant.slug}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {tenant.memberCount || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => setSelectedTenant(tenant)}
                    className="text-blue-600 hover:text-blue-800 mr-4"
                  >
                    Manage
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete tenant "${tenant.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(tenant.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {(!data?.tenants || data.tenants.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No tenants yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Tenant Modal */}
      {isCreateModalOpen && (
        <CreateTenantModal
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
          error={createMutation.error?.message}
        />
      )}

      {/* Tenant Members Modal */}
      {selectedTenant && (
        <TenantMembersModal
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
        />
      )}
    </div>
  );
}

interface QuotaOverrides {
  maxKbs?: number;
  maxAgents?: number;
  maxUploadedDocsPerMonth?: number;
  maxScrapedPagesPerMonth?: number;
  maxCrawlConcurrency?: number;
  chatRateLimitPerMinute?: number;
}

const defaultQuotas: Required<QuotaOverrides> = {
  maxKbs: 10,
  maxAgents: 10,
  maxUploadedDocsPerMonth: 1000,
  maxScrapedPagesPerMonth: 1000,
  maxCrawlConcurrency: 5,
  chatRateLimitPerMinute: 60,
};

function CreateTenantModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; slug: string; ownerEmail?: string; quotas?: QuotaOverrides }) => void;
  isLoading: boolean;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [quotaSettingsOpen, setQuotaSettingsOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaOverrides>({});

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate slug from name
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  };

  const handleQuotaChange = (key: keyof QuotaOverrides, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || value === "") {
      // Remove the override to use default
      const newQuotas = { ...quotas };
      delete newQuotas[key];
      setQuotas(newQuotas);
    } else {
      setQuotas({ ...quotas, [key]: numValue });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      slug,
      ownerEmail: ownerEmail || undefined,
      quotas: Object.keys(quotas).length > 0 ? quotas : undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Tenant</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tenant Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Acme Corp"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="acme-corp"
              pattern="[a-z0-9-]+"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              URL-friendly identifier. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Owner Email (optional)
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="owner@example.com"
            />
            <p className="mt-1 text-xs text-gray-500">
              If specified, this user will be the owner. Otherwise, you become the owner.
            </p>
          </div>

          {/* Quota Settings - Collapsible */}
          <Collapsible open={quotaSettingsOpen} onOpenChange={setQuotaSettingsOpen}>
            <div className="pt-4 border-t border-gray-200">
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left">
                <h3 className="text-sm font-medium text-gray-900">Quota Settings</h3>
                <svg
                  className={`w-5 h-5 text-gray-500 transition-transform ${quotaSettingsOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <p className="text-xs text-gray-500 mb-4">
                  Override default quota limits for this tenant. Leave empty to use system defaults.
                </p>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Knowledge Bases
                      </label>
                      <input
                        type="number"
                        value={quotas.maxKbs ?? ""}
                        onChange={(e) => handleQuotaChange("maxKbs", e.target.value)}
                        placeholder={String(defaultQuotas.maxKbs)}
                        min="1"
                        max="1000"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Agents
                      </label>
                      <input
                        type="number"
                        value={quotas.maxAgents ?? ""}
                        onChange={(e) => handleQuotaChange("maxAgents", e.target.value)}
                        placeholder={String(defaultQuotas.maxAgents)}
                        min="1"
                        max="1000"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Uploads / Month
                      </label>
                      <input
                        type="number"
                        value={quotas.maxUploadedDocsPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxUploadedDocsPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxUploadedDocsPerMonth)}
                        min="1"
                        max="100000"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Pages Scraped / Month
                      </label>
                      <input
                        type="number"
                        value={quotas.maxScrapedPagesPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxScrapedPagesPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxScrapedPagesPerMonth)}
                        min="1"
                        max="100000"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Crawl Concurrency
                      </label>
                      <input
                        type="number"
                        value={quotas.maxCrawlConcurrency ?? ""}
                        onChange={(e) => handleQuotaChange("maxCrawlConcurrency", e.target.value)}
                        placeholder={String(defaultQuotas.maxCrawlConcurrency)}
                        min="1"
                        max="50"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Chat Rate / Min
                      </label>
                      <input
                        type="number"
                        value={quotas.chatRateLimitPerMinute ?? ""}
                        onChange={(e) => handleQuotaChange("chatRateLimitPerMinute", e.target.value)}
                        placeholder={String(defaultQuotas.chatRateLimitPerMinute)}
                        min="1"
                        max="1000"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
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
              disabled={isLoading || !name || !slug}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Creating..." : "Create Tenant"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type TenantModalTab = "members" | "alerts";

function TenantMembersModal({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TenantModalTab>("members");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const queryClient = useQueryClient();

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["tenant-members", tenant.id],
    queryFn: () => api.listTenantMembers(tenant.id),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.addTenantMember(tenant.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
      setAddEmail("");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateTenantMember(tenant.id, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeTenantMember(tenant.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{tenant.name}</h2>
            <p className="text-sm text-gray-500">Manage tenant settings</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-4">
          <button
            onClick={() => setActiveTab("members")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "members"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Members
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
        </div>

        {activeTab === "members" && (
          <>
            {/* Add Member Form */}
            <form onSubmit={handleAddMember} className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Add Member</h3>
              <div className="flex gap-3">
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
                  Add
                </button>
              </div>
              {addMemberMutation.error && (
                <p className="mt-2 text-sm text-red-600">{addMemberMutation.error.message}</p>
              )}
            </form>

            {/* Members List */}
            {isLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded"></div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {membersData?.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
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
                          if (confirm(`Remove ${member.email} from this tenant?`)) {
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
                  <p className="text-center text-gray-500 py-4">No members yet.</p>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "alerts" && (
          <TenantAlertSettingsTab tenantId={tenant.id} />
        )}
      </div>
    </div>
  );
}

function TenantAlertSettingsTab({ tenantId }: { tenantId: string }) {
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

  // Initialize local settings when data loads
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
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          Configure health alert notifications for this tenant. Owners and admins can receive
          automated alerts when issues are detected.
        </p>
      </div>

      {/* Enable/Disable Alerts */}
      <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Enable Alerts</h3>
          <p className="text-xs text-gray-500">Receive health alerts for this tenant</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={getValue("enabled") ?? true}
            onChange={(e) => handleChange("enabled", e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Notification Recipients */}
      <div className="space-y-4 p-4 bg-white border border-gray-200 rounded-lg">
        <h3 className="text-sm font-medium text-gray-900">Notification Recipients</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">Notify Owners</p>
            <p className="text-xs text-gray-500">All tenant owners receive alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={getValue("notifyOwners") ?? true}
              onChange={(e) => handleChange("notifyOwners", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">Notify Admins</p>
            <p className="text-xs text-gray-500">All tenant admins receive alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={getValue("notifyAdmins") ?? false}
              onChange={(e) => handleChange("notifyAdmins", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Additional Emails</label>
          <input
            type="text"
            value={getValue("additionalEmails") || ""}
            onChange={(e) => handleChange("additionalEmails", e.target.value || null)}
            placeholder="email1@example.com, email2@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Comma-separated list of additional email addresses</p>
        </div>
      </div>

      {/* Threshold Overrides */}
      <div className="space-y-4 p-4 bg-white border border-gray-200 rounded-lg">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Threshold Overrides</h3>
          <p className="text-xs text-gray-500">Leave empty to use system defaults</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Error Rate (%)</label>
            <input
              type="number"
              value={getValue("errorRateThreshold") ?? ""}
              onChange={(e) =>
                handleChange("errorRateThreshold", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="10"
              min="1"
              max="100"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Quota Warning (%)</label>
            <input
              type="number"
              value={getValue("quotaWarningThreshold") ?? ""}
              onChange={(e) =>
                handleChange("quotaWarningThreshold", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="80"
              min="1"
              max="100"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Inactivity (days)</label>
            <input
              type="number"
              value={getValue("inactivityDays") ?? ""}
              onChange={(e) =>
                handleChange("inactivityDays", e.target.value ? parseInt(e.target.value) : null)
              }
              placeholder="7"
              min="0"
              max="365"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
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
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">Alert settings saved successfully!</p>
        </div>
      )}

      {updateMutation.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{updateMutation.error.message}</p>
        </div>
      )}
    </div>
  );
}
