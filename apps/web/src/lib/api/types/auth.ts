export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  tenantId: string;
  role: string;
  isSystemAdmin: boolean;
}

export interface AuthResponse {
  user: { id: string; email: string };
  token: string;
  token_type: string;
}
