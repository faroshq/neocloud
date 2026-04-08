import type { PiletApi } from 'platform-app-shell';
import { VMListPage } from './VMListPage';
import { VMDetailPage } from './VMDetailPage';
import { VMCreatePage } from './VMCreatePage';

export function setup(api: PiletApi) {
  api.registerPage('/console/vm', VMListPage);
  api.registerPage('/console/vm/create', VMCreatePage);
  api.registerPage('/console/vm/:name', VMDetailPage);

  api.registerMenu(() => {
    return (
      <a href="/console/vm" style={{ display: 'block', padding: '8px 16px', color: 'inherit', textDecoration: 'none' }}>
        Virtual Machines
      </a>
    );
  });
}
