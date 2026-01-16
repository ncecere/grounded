import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TenantApiKey, type TenantApiKeyWithSecret, getCurrentTenantId } from "../lib/api";
import { Users, Bell, Key } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MembersList } from "@/components/members-list";
import { AlertSettingsForm } from "@/components/alert-settings-form";
import { ApiKeyManager } from "@/components/api-key-manager";

type SettingsTab = "members" | "alerts" | "api-keys";

const API_KEY_SCOPES = [
  { value: "chat", label: "Chat", description: "Chat allows chat API access" },
  { value: "read", label: "Read", description: "Read allows reading KBs and agents" },
  { value: "write", label: "Write", description: "Write allows modifications" },
];

export function TenantSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("members");
  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Users}
          title="No tenant selected"
          description="Please select a tenant first."
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Tenant Settings"
        description="Manage your team members and notification preferences."
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="members" className="gap-2">
            <Users className="w-4 h-4" />
            Team Members
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="w-4 h-4" />
            Alert Settings
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="gap-2">
            <Key className="w-4 h-4" />
            API Keys
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <MembersList tenantId={tenantId} canEdit={true} />
        </TabsContent>

        <TabsContent value="alerts">
          <AlertSettingsForm tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApiKeysTab({ tenantId }: { tenantId: string }) {
  const [newKey, setNewKey] = useState<TenantApiKeyWithSecret | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-api-keys", tenantId],
    queryFn: () => api.listTenantApiKeys(tenantId),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes?: string[]; expiresAt?: string }) =>
      api.createTenantApiKey(tenantId, data),
    onSuccess: (data) => {
      setNewKey(data);
      queryClient.invalidateQueries({ queryKey: ["tenant-api-keys", tenantId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.revokeTenantApiKey(tenantId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-api-keys", tenantId] });
    },
  });

  return (
    <ApiKeyManager<TenantApiKey, TenantApiKeyWithSecret>
      keys={data?.apiKeys || []}
      isLoading={isLoading}
      onRevoke={(id) => revokeMutation.mutate(id)}
      isRevoking={revokeMutation.isPending}
      onCreate={(data) => createMutation.mutate(data)}
      isCreating={createMutation.isPending}
      createError={createMutation.error}
      newKey={newKey}
      onNewKeyDismiss={() => setNewKey(null)}
      title="API Keys"
      description="Manage API keys for programmatic access to this tenant."
      infoTitle="Using API Keys"
      infoDescription="API keys allow programmatic access to your tenant's resources. Use them with the Authorization header:"
      authHeaderExample="Authorization: Bearer grounded_..."
      scopes={API_KEY_SCOPES}
      showScopes={true}
    />
  );
}
