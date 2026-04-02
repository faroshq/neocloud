const TOKEN_KEY = 'platform-oidc-token';
const AUTH_RESPONSE_KEY = 'platform-auth-response';

export interface AuthResponse {
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  email: string;
  clusterName?: string;
  issuerURL?: string;
  clientID?: string;
  hubURL?: string;
}

export function getAuthResponse(): AuthResponse | null {
  const raw = localStorage.getItem(AUTH_RESPONSE_KEY);
  if (!raw) return null;
  try {
    const resp: AuthResponse = JSON.parse(raw);
    // Check expiry with 60s buffer.
    if (resp.expiresAt && Date.now() / 1000 > resp.expiresAt - 60) {
      clearAuth();
      return null;
    }
    return resp;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  const resp = getAuthResponse();
  return resp?.idToken ?? localStorage.getItem(TOKEN_KEY);
}

export function getEmail(): string | null {
  return getAuthResponse()?.email ?? null;
}

export function getClusterName(): string | null {
  return getAuthResponse()?.clusterName ?? null;
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_RESPONSE_KEY);
}

export function startLogin(): void {
  const callbackUrl = `${window.location.origin}/console/auth/callback`;
  window.location.href = `/auth/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`;
}

export function handleAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('response');
  if (!encoded) return false;

  try {
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const resp: AuthResponse = JSON.parse(json);
    localStorage.setItem(AUTH_RESPONSE_KEY, JSON.stringify(resp));
    localStorage.setItem(TOKEN_KEY, resp.idToken);
    return true;
  } catch {
    return false;
  }
}

export function signOut(): void {
  clearAuth();
  window.location.href = '/console';
}
