import type { PiletApi } from 'platform-app-shell';
import { KCListPage } from './KCListPage';
import { KCDetailPage } from './KCDetailPage';

export function setup(api: PiletApi) {
  api.registerPage('/console/kc', KCListPage);
  api.registerPage('/console/kc/:name', KCDetailPage);

  api.registerMenu(() => {
    return (
      <a href="/console/kc" style={{ display: 'block', padding: '8px 16px', color: 'inherit', textDecoration: 'none' }}>
        Kubernetes Clusters
      </a>
    );
  });
}
