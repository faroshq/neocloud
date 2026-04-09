import * as React from 'react';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import CloudQueueRoundedIcon from '@mui/icons-material/CloudQueueRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SvgIconComponent = React.ComponentType<any>;

export interface ResourceDef {
  /** Plural lowercase name used in API path, e.g. "virtualmachines" */
  plural: string;
  /** Singular display name */
  displayName: string;
  /** Plural display name */
  displayNamePlural: string;
  /** Route path segment, e.g. "/vm" */
  path: string;
  /** MUI icon component */
  icon: SvgIconComponent;
  /** Which spec fields to show as table columns */
  columns: ColumnDef[];
  /** How to derive a status label from a resource */
  statusExtractor: (resource: Record<string, unknown>) => { label: string; color: string };
}

export interface ColumnDef {
  header: string;
  /** Dot-separated path into spec/status, e.g. "spec.cpu" */
  field: string;
  mono?: boolean;
}

export interface ApiGroupDef {
  /** API group, e.g. "compute.cloud.platform" */
  group: string;
  /** API version */
  version: string;
  /** Display label for nav section */
  label: string;
  /** Accent color for the group */
  accentColor: string;
  /** Gradient for stat cards */
  gradient: string;
  /** Resources in this group */
  resources: ResourceDef[];
}

// ── Status helpers ─────────────────────────────────────────────

function phaseStatus(resource: Record<string, unknown>): { label: string; color: string } {
  const status = (resource.status || {}) as Record<string, unknown>;
  const phase = (status.phase as string) || 'Unknown';
  const colorMap: Record<string, string> = {
    Running: '#34d399',
    Ready: '#34d399',
    Available: '#34d399',
    Assigned: '#34d399',
    Succeeded: '#34d399',
    Bound: '#34d399',
    Pending: '#fbbf24',
    Provisioning: '#fbbf24',
    Allocating: '#fbbf24',
    Queued: '#fbbf24',
    Failed: '#f87171',
    Stopped: '#71717a',
    Released: '#71717a',
    Terminating: '#71717a',
  };
  return { label: phase, color: colorMap[phase] || '#71717a' };
}

function conditionStatus(resource: Record<string, unknown>): { label: string; color: string } {
  const status = (resource.status || {}) as Record<string, unknown>;
  const conditions = (status.conditions as Array<Record<string, string>>) || [];
  const available = conditions.find((c) => c.type === 'Available' || c.type === 'Ready');
  if (available?.status === 'True') {
    return { label: 'Available', color: '#34d399' };
  }
  return { label: 'Pending', color: '#fbbf24' };
}

// ── Group definitions ──────────────────────────────────────────

export const apiGroups: ApiGroupDef[] = [
  {
    group: 'compute.cloud.platform',
    version: 'v1alpha1',
    label: 'Compute',
    accentColor: '#818cf8',
    gradient: 'linear-gradient(135deg, #818cf8, #6366f1)',
    resources: [
      {
        plural: 'virtualmachines',
        displayName: 'Virtual Machine',
        displayNamePlural: 'Virtual Machines',
        path: '/vm',
        icon: DnsRoundedIcon,
        columns: [
          { header: 'CPU', field: 'spec.cpu', mono: true },
          { header: 'Memory', field: 'spec.memory', mono: true },
          { header: 'Disk', field: 'spec.disk', mono: true },
        ],
        statusExtractor: phaseStatus,
      },
      {
        plural: 'kubernetesclusters',
        displayName: 'Kubernetes Cluster',
        displayNamePlural: 'Kubernetes Clusters',
        path: '/kc',
        icon: HubRoundedIcon,
        columns: [
          { header: 'Version', field: 'spec.version', mono: true },
          { header: 'Nodes', field: 'spec.nodeCount', mono: true },
        ],
        statusExtractor: conditionStatus,
      },
    ],
  },
  {
    group: 'storage.cloud.platform',
    version: 'v1alpha1',
    label: 'Storage',
    accentColor: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    resources: [
      {
        plural: 'volumes',
        displayName: 'Volume',
        displayNamePlural: 'Volumes',
        path: '/volumes',
        icon: StorageRoundedIcon,
        columns: [
          { header: 'Size', field: 'spec.size', mono: true },
          { header: 'Storage Class', field: 'spec.storageClass', mono: true },
          { header: 'Access Mode', field: 'spec.accessMode' },
        ],
        statusExtractor: phaseStatus,
      },
      {
        plural: 'objectbuckets',
        displayName: 'Object Bucket',
        displayNamePlural: 'Object Buckets',
        path: '/objectbuckets',
        icon: CloudQueueRoundedIcon,
        columns: [
          { header: 'Quota', field: 'spec.quota', mono: true },
        ],
        statusExtractor: phaseStatus,
      },
    ],
  },
  {
    group: 'network.cloud.platform',
    version: 'v1alpha1',
    label: 'Networking',
    accentColor: '#22d3ee',
    gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
    resources: [
      {
        plural: 'publicips',
        displayName: 'Public IP',
        displayNamePlural: 'Public IPs',
        path: '/publicips',
        icon: PublicRoundedIcon,
        columns: [
          { header: 'IP Address', field: 'status.address', mono: true },
          { header: 'Target', field: 'spec.target.name' },
        ],
        statusExtractor: phaseStatus,
      },
    ],
  },
  {
    group: 'ai.cloud.platform',
    version: 'v1alpha1',
    label: 'AI',
    accentColor: '#a78bfa',
    gradient: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
    resources: [
      {
        plural: 'notebooks',
        displayName: 'Notebook',
        displayNamePlural: 'Notebooks',
        path: '/notebooks',
        icon: ScienceRoundedIcon,
        columns: [
          { header: 'Image', field: 'spec.image' },
          { header: 'CPU', field: 'spec.resources.cpu', mono: true },
          { header: 'Memory', field: 'spec.resources.memory', mono: true },
        ],
        statusExtractor: phaseStatus,
      },
      {
        plural: 'gpujobs',
        displayName: 'GPU Job',
        displayNamePlural: 'GPU Jobs',
        path: '/gpujobs',
        icon: MemoryRoundedIcon,
        columns: [
          { header: 'GPU Count', field: 'spec.gpuCount', mono: true },
          { header: 'Timeout', field: 'spec.timeout', mono: true },
        ],
        statusExtractor: phaseStatus,
      },
    ],
  },
];

/** Flat list of all resources with their group info attached */
export function allResources(): Array<ResourceDef & { group: string; version: string; groupLabel: string; accentColor: string; gradient: string }> {
  return apiGroups.flatMap((g) =>
    g.resources.map((r) => ({
      ...r,
      group: g.group,
      version: g.version,
      groupLabel: g.label,
      accentColor: g.accentColor,
      gradient: g.gradient,
    })),
  );
}

/** Find a resource definition by its route path */
export function findResourceByPath(path: string): ReturnType<typeof allResources>[number] | undefined {
  return allResources().find((r) => r.path === path);
}

/** Get the nested value from an object using dot-notation path */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
