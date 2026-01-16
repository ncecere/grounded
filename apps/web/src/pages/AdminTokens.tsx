import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AdminApiToken, type AdminApiTokenWithSecret } from "../lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ApiKeyManager } from "@/components/api-key-manager";

export function AdminTokens() {
  const [newToken, setNewToken] = useState<AdminApiTokenWithSecret | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: api.listAdminTokens,
  });

  const createMutation = useMutation({
    mutationFn: api.createAdminToken,
    onSuccess: (data) => {
      setNewToken(data);
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeAdminToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    },
  });

  return (
    <div className="p-6">
      <PageHeader
        title="API Tokens"
        description="Create and manage API tokens for system administration automation."
      />

      <ApiKeyManager<AdminApiToken, AdminApiTokenWithSecret>
        keys={data?.tokens || []}
        isLoading={isLoading}
        onRevoke={(id) => revokeMutation.mutate(id)}
        isRevoking={revokeMutation.isPending}
        onCreate={(data) => createMutation.mutate({
          name: data.name,
          expiresAt: data.expiresAt,
        })}
        isCreating={createMutation.isPending}
        createError={createMutation.error}
        newKey={newToken}
        onNewKeyDismiss={() => setNewToken(null)}
        title="Admin Tokens"
        description="Manage admin tokens for system automation and CI/CD pipelines."
        infoTitle="Using Admin Tokens"
        infoDescription="Admin tokens allow you to authenticate API requests for automation and CI/CD pipelines. Use them with the Authorization header:"
        authHeaderExample="Authorization: Bearer grounded_admin_..."
        showScopes={false}
      />
    </div>
  );
}
