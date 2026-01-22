import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, clearToken, clearCurrentTenantId, type User } from "../../lib/api";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  hasToken: boolean;
  refreshUser: () => Promise<User | null>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => getToken());

  const { data: user, isLoading, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
    retry: false,
    enabled: !!token,
  });

  const refreshUser = async () => {
    setToken(getToken());
    const result = await refetch();
    return result.data ?? null;
  };

  const logout = () => {
    clearCurrentTenantId();
    clearToken();
    setToken(null);
    queryClient.setQueryData(["me"], null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user: user ?? null,
      isLoading,
      hasToken: !!token,
      refreshUser,
      logout,
    }),
    [user, isLoading, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
