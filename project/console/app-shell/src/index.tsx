import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance, Piral } from 'piral-core';
import { createMenuApi } from 'piral-menu';
import { createDashboardApi } from 'piral-dashboard';
import { createNotificationsApi } from 'piral-notifications';
import { Layout } from './layout';
import { Dashboard } from './dashboard';
import { VMListPage } from './pages/VMListPage';
import { VMDetailPage } from './pages/VMDetailPage';
import { VMCreatePage } from './pages/VMCreatePage';
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

// Compute pages
instance.root.registerPage('/vm', () => <VMListPage />);
instance.root.registerPage('/vm/create', () => <VMCreatePage />);
instance.root.registerPage('/vm/:name', () => <VMDetailPage />);

// Kubernetes pages
instance.root.registerPage('/kc', () => <KCListPage />);
instance.root.registerPage('/kc/:name', () => <KCDetailPage />);

const root = createRoot(document.getElementById('app')!);
root.render(<Piral instance={instance} />);
