import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance, Piral } from 'piral-core';
import { createMenuApi } from 'piral-menu';
import { createNotificationsApi } from 'piral-notifications';
import { Layout } from './layout';
import { Dashboard } from './dashboard';
import { VMDetailPage } from './pages/VMDetailPage';
import { VMCreatePage } from './pages/VMCreatePage';
import { VMEditPage } from './pages/VMEditPage';
import { ComputePage } from './pages/ComputePage';
import { CloudInitDetailPage } from './pages/CloudInitDetailPage';
import { CloudInitCreatePage } from './pages/CloudInitCreatePage';
import { KCListPage } from './pages/KCListPage';
import { KCDetailPage } from './pages/KCDetailPage';
import { ResourceListPage } from './pages/ResourceListPage';
import { ResourceDetailPage } from './pages/ResourceDetailPage';
import { apiGroups } from './resources';

const instance = createInstance({
  state: {
    components: {
      Layout,
    },
    app: {
      loading: false,
      error: undefined,
    },
  },
  plugins: [
    createMenuApi(),
    createNotificationsApi(),
  ],
  requestPilets: async () => [],
});

// Register pages. Paths are relative to basename (/console).
instance.root.registerPage('/', () => <Dashboard />);
instance.root.registerPage('/auth/callback', () => null);

// Compute pages (VM list + Cloud Init as tabs) — custom pages
instance.root.registerPage('/vm', () => <ComputePage />);
instance.root.registerPage('/vm/create', () => <VMCreatePage />);
instance.root.registerPage('/vm/:name/edit', () => <VMEditPage />);
instance.root.registerPage('/vm/:name', () => <VMDetailPage />);

// Cloud Init pages (detail/create/edit still have their own routes)
instance.root.registerPage('/ci/create', () => <CloudInitCreatePage />);
instance.root.registerPage('/ci/:name/edit', () => <CloudInitCreatePage />);
instance.root.registerPage('/ci/:name', () => <CloudInitDetailPage />);

// Kubernetes pages — custom pages
instance.root.registerPage('/kc', () => <KCListPage />);
instance.root.registerPage('/kc/:name', () => <KCDetailPage />);

// Generic resource pages for all other API groups/resources
// Skip resources that already have custom pages above
const customPaths = new Set(['/vm', '/kc']);

for (const group of apiGroups) {
  for (const resource of group.resources) {
    if (customPaths.has(resource.path)) continue;

    const g = group.group;
    const v = group.version;
    const r = resource;

    instance.root.registerPage(resource.path, () => (
      <ResourceListPage group={g} version={v} resource={r} />
    ));
    instance.root.registerPage(`${resource.path}/:name`, () => (
      <ResourceDetailPage group={g} version={v} resource={r} />
    ));
  }
}

const root = createRoot(document.getElementById('app')!);
root.render(<Piral instance={instance} />);
