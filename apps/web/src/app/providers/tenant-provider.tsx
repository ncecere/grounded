import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  getCurrentTenantId,
  setCurrentTenantId,
  clearCurrentTenantId,
  type UserTenant,
} from "../../lib/api";
import { useAuth } from "./auth-provider";

type TenantContextValue = {
  tenants: UserTenant[];
  currentTenant: UserTenant | null;
  isLoading: boolean;
  hasTenant: boolean;
  canManageTenant: boolean;
  selectTenant: (tenant: UserTenant) => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentTenant, setCurrentTenant] = useState<UserTenant | null>(null);

  const { data: tenantsData, isLoading } = useQuery({
    queryKey: ["my-tenants"],
    queryFn: api.getMyTenants,
    enabled: !!user,
  });

  const tenants = tenantsData?.tenants ?? [];

  useEffect(() => {
    if (!user) {
      setCurrentTenant(null);
      clearCurrentTenantId();
      return;
    }

    if (tenants.length === 0) {
      setCurrentTenant(null);
      clearCurrentTenantId();
      return;
    }

    const savedTenantId = getCurrentTenantId();
    const savedTenant = savedTenantId
      ? tenants.find((tenant) => tenant.id === savedTenantId)
      : null;

    const nextTenant = savedTenant ?? tenants[0];
    setCurrentTenant(nextTenant);
    if (!savedTenant && nextTenant) {
      setCurrentTenantId(nextTenant.id);
    }
  }, [user, tenants]);

  const selectTenant = (tenant: UserTenant) => {
    setCurrentTenant(tenant);
    setCurrentTenantId(tenant.id);
    queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
  };

  const hasTenant = !!currentTenant;
  const canManageTenant = currentTenant?.role === "owner" || currentTenant?.role === "admin";

  const value = useMemo<TenantContextValue>(
    () => ({
      tenants,
      currentTenant,
      isLoading,
      hasTenant,
      canManageTenant,
      selectTenant,
    }),
    [tenants, currentTenant, isLoading, hasTenant, canManageTenant]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
};
