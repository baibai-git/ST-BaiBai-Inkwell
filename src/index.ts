import App from '@/App.vue';
import { initializePenSettings } from '@/api/settings';
import { initializeSharedChannels } from '@/api/sharedChannels';
import { checkForUpdate } from '@/api/update';
import { bindEditButtons } from '@/editButton';
import { injectMenuButton } from '@/menu';
import { guardEditableArrowKeys } from '@/st/keyboard';
import { versionedAssetUrl } from '@/version';
import '@/styles/base.css';
import '@/styles/theme.css';
import { createApp } from 'vue';

const HOST_ID = 'bby-app-host';

function mount(): void {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }

  host.style.setProperty('display', 'contents', 'important');
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.textContent = '';
  guardEditableArrowKeys(shadow);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = versionedAssetUrl('./index.css', import.meta.url);
  shadow.appendChild(link);

  const container = document.createElement('div');
  shadow.appendChild(container);
  const app = createApp(App);
  app.mount(container);
  window.addEventListener('pagehide', () => app.unmount(), { once: true });
}

$(() => {
  mount();
  injectMenuButton();
  bindEditButtons();
  void Promise.all([initializeSharedChannels(), initializePenSettings()]);
  // 后台检测更新(实时比对本地/远端 manifest 版本;失败静默,不阻断启动)
  void checkForUpdate();
});
