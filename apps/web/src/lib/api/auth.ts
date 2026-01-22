import { request, setToken, clearToken } from "./client";
import type { AuthResponse, User } from "./types/auth";
import type { UserTenant } from "@grounded/shared/types/admin";

export const authApi = {
  getMe: () => request<User>("/auth/me"),

  logout: () => {
    clearToken();
    return Promise.resolve();
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(response.token);
    return response;
  },

  register: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(response.token);
    return response;
  },

  getMyTenants: () => request<{ tenants: UserTenant[] }>("/auth/tenants"),
};
