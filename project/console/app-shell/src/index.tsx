import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance, Piral } from 'piral-core';
import { createMenuApi } from 'piral-menu';
import { createDashboardApi } from 'piral-dashboard';
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

const instance = createInstance({
  state: {
    components: {
      Layout,
    },
  },
  plugins: [
    createMenuApi(),
    createDashboardApi({ defaultPreferences: {} }),
    createNotificationsApi(),
  ],
  requestPilets: async () => {
    // Pilets can be loaded from a feed service in production.
    return [];
  },
});

// Register pages. Paths are relative to basename (/console).
instance.root.registerPage('/', () => <Dashboard />);
instance.root.registerPage('/auth/callback', () => null);

// Compute pages (VM list + Cloud Init as tabs)
instance.root.registerPage('/vm', () => <ComputePage />);
instance.root.registerPage('/vm/create', () => <VMCreatePage />);
instance.root.registerPage('/vm/:name/edit', () => <VMEditPage />);
instance.root.registerPage('/vm/:name', () => <VMDetailPage />);

// Cloud Init pages (detail/create/edit still have their own routes)
instance.root.registerPage('/ci/create', () => <CloudInitCreatePage />);
instance.root.registerPage('/ci/:name/edit', () => <CloudInitCreatePage />);
instance.root.registerPage('/ci/:name', () => <CloudInitDetailPage />);

// Kubernetes pages
instance.root.registerPage('/kc', () => <KCListPage />);
instance.root.registerPage('/kc/:name', () => <KCDetailPage />);

const root = createRoot(document.getElementById('app')!);
root.render(<Piral instance={instance} />);
