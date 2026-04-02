import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance, Piral } from 'piral-core';
import { createMenuApi } from 'piral-menu';
import { createDashboardApi } from 'piral-dashboard';
import { createNotificationsApi } from 'piral-notifications';
import { Layout } from './layout';
import { Dashboard } from './dashboard';

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
    // For now, pages are registered directly in the shell.
    return [];
  },
});

// Register default pages.
instance.root.registerPage('/console', () => <Dashboard />);
instance.root.registerPage('/console/auth/callback', () => null);

const root = createRoot(document.getElementById('app')!);
root.render(<Piral instance={instance} />);
