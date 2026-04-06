// Re-export API client for use in pilet components.
// In a full setup, this would come from the app shell's shared API.
// For now, we inline it since pilets can't directly import from the shell at build time.

export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    creationTimestamp?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

interface K8sListResponse<T = K8sResource> {
  apiVersion: string;
  kind: string;
  items: T[];
}

function getToken(): string | null {
  const raw = localStorage.getItem('platform-auth-response');
  if (!raw) return localStorage.getItem('platform-oidc-token');
  try {
    const resp = JSON.parse(raw);
    if (resp.expiresAt && Date.now() / 1000 > resp.expiresAt - 60) return null;
    return resp.idToken;
  } catch { return null; }
}

function getClusterName(): string | null {
  const raw = localStorage.getItem('platform-auth-response');
  if (!raw) return null;
  try { return JSON.parse(raw).clusterName || null; } catch { return null; }
}

function baseUrl(): string {
  const cluster = getClusterName();
  return cluster ? `/clusters/${cluster}` : '';
}

function headers(): HeadersInit {
  const token = getToken();
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function k8sList<T = K8sResource>(path: string): Promise<T[]> {
  const resp = await fetch(`${baseUrl()}${path}`, { headers: headers() });
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  const data: K8sListResponse<T> = await resp.json();
  return data.items;
}

async function k8sGet<T = K8sResource>(path: string): Promise<T> {
  const resp = await fetch(`${baseUrl()}${path}`, { headers: headers() });
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function k8sCreate<T = K8sResource>(path: string, resource: unknown): Promise<T> {
  const resp = await fetch(`${baseUrl()}${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(resource),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

const COMPUTE_API = '/apis/compute.cloud.platform/v1alpha1';

export const vmApi = {
  list: () => k8sList(`${COMPUTE_API}/virtualmachines`),
  get: (name: string) => k8sGet(`${COMPUTE_API}/virtualmachines/${name}`),
  create: (resource: unknown) => k8sCreate(`${COMPUTE_API}/virtualmachines`, resource),
};

export const publicImageApi = {
  list: () => k8sList<K8sResource>(`${COMPUTE_API}/publicimages`),
};
