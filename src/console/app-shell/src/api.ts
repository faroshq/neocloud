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

// ── Generic resource API ─────────────────────────────────────────

export function resourceApi(group: string, version: string, plural: string) {
  const base = `/apis/${group}/${version}/${plural}`;
  return {
    list: () => k8sList(base),
    get: (name: string) => k8sGet(`${base}/${name}`),
    create: (resource: unknown) => k8sCreate(base, resource),
    delete: (name: string) => k8sDelete(`${base}/${name}`),
  };
}

// ── API Discovery ────────────────────────────────────────────────

export interface APIGroup {
  name: string;
  versions: Array<{ groupVersion: string; version: string }>;
}

/** Fetch available API groups from the cluster */
export async function discoverApiGroups(): Promise<APIGroup[]> {
  const resp = await fetch(`${baseUrl()}/apis`, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`API discovery error ${resp.status}: ${resp.statusText}`);
  }
  const data = await resp.json();
  return (data.groups || []) as APIGroup[];
}

// ── Legacy resource-specific helpers (kept for existing pages) ───

const COMPUTE_API = '/apis/compute.cloud.platform/v1alpha1';

export const vmApi = resourceApi('compute.cloud.platform', 'v1alpha1', 'virtualmachines');

export const kcApi = resourceApi('compute.cloud.platform', 'v1alpha1', 'kubernetesclusters');

export const cloudInitApi = resourceApi('compute.cloud.platform', 'v1alpha1', 'cloudinits');
