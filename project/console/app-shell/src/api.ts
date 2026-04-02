import { getToken, getClusterName } from './auth';

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

export interface K8sListResponse<T = K8sResource> {
  apiVersion: string;
  kind: string;
  items: T[];
}

function baseUrl(): string {
  const cluster = getClusterName();
  if (cluster) {
    return `/clusters/${cluster}`;
  }
  return '';
}

function headers(): HeadersInit {
  const token = getToken();
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) {
    h['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

export async function k8sGet<T = K8sResource>(path: string): Promise<T> {
  const resp = await fetch(`${baseUrl()}${path}`, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

export async function k8sList<T = K8sResource>(path: string): Promise<T[]> {
  const resp = await fetch(`${baseUrl()}${path}`, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  }
  const data: K8sListResponse<T> = await resp.json();
  return data.items;
}

export async function k8sCreate<T = K8sResource>(path: string, resource: unknown): Promise<T> {
  const resp = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(resource),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function k8sDelete(path: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}${path}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${resp.statusText}`);
  }
}

// Resource-specific helpers
const COMPUTE_API = '/apis/compute.cloud.platform/v1alpha1';

export const vmApi = {
  list: () => k8sList(`${COMPUTE_API}/virtualmachines`),
  get: (name: string) => k8sGet(`${COMPUTE_API}/virtualmachines/${name}`),
  create: (resource: unknown) => k8sCreate(`${COMPUTE_API}/virtualmachines`, resource),
  delete: (name: string) => k8sDelete(`${COMPUTE_API}/virtualmachines/${name}`),
};

export const kcApi = {
  list: () => k8sList(`${COMPUTE_API}/kubernetesclusters`),
  get: (name: string) => k8sGet(`${COMPUTE_API}/kubernetesclusters/${name}`),
  create: (resource: unknown) => k8sCreate(`${COMPUTE_API}/kubernetesclusters`, resource),
  delete: (name: string) => k8sDelete(`${COMPUTE_API}/kubernetesclusters/${name}`),
};
