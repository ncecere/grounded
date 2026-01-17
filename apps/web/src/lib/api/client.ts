// Runtime config injected via config.js at container startup
// In K8s, set API_URL="" so Ingress handles /api routing
// In local dev, set API_URL="http://localhost:3001"
declare global {
  interface Window {
    __GROUNDED_CONFIG__?: { API_URL?: string };
  }
}

const getApiBase = (): string => {
  if (typeof window !== "undefined") {
    return (window.__GROUNDED_CONFIG__?.API_URL || "") + "/api/v1";
  }
  return "/api/v1";
};

export const API_BASE = getApiBase();

// Token storage
const TOKEN_KEY = "grounded_auth_token";
const TENANT_KEY = "grounded_current_tenant";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getCurrentTenantId(): string | null {
  return localStorage.getItem(TENANT_KEY);
}

export function setCurrentTenantId(tenantId: string): void {
  localStorage.setItem(TENANT_KEY, tenantId);
}

export function clearCurrentTenantId(): void {
  localStorage.removeItem(TENANT_KEY);
}

export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const tenantId = getCurrentTenantId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (tenantId) {
    headers["X-Tenant-ID"] = tenantId;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    if (response.status === 401) {
      clearToken();
    }
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
