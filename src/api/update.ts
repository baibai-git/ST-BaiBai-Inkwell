import { getContext } from '@/st/context';
import { PLUGIN_VERSION } from '@/version';
import { reactive } from 'vue';

/**
 * 自检更新:实时比对本地/远端 manifest 版本(与柏宝书同一套机制)。
 * 远端来源是 GitHub raw 的 manifest.json;执行更新走 ST 自带的 /api/extensions/update。
 * 检测失败一律静默(不误报、不误清),只有用户点了「更新」且更新 API 报错才抛给 UI 提示。
 */
const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/baibai-git/ST-BaiBai-Inkwell/main/manifest.json';
const FALLBACK_FOLDER = 'ST-BaiBai-Pen';

export const updateState = reactive({
  current: PLUGIN_VERSION,
  latest: '',
  available: false,
  checking: false,
  updating: false,
});

// 会话内只自动查一次;刻意不写 localStorage,避免「更新完还提示有更新」
let checkedThisSession = false;

/** 按 `.` 分段数值比较,缺段补 0(兼容 0.1 与 0.1.x 互比) */
export function isNewer(a: string, b: string): boolean {
  if (!a || !b) return false;
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function readRemoteVersion(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(`${REMOTE_MANIFEST_URL}?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!resp.ok) return '';
      const json = (await resp.json()) as { version?: string };
      return String(json?.version ?? '').trim();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return '';
  }
}

export async function checkForUpdate(force = false): Promise<void> {
  if (updateState.checking) return;
  if (checkedThisSession && !force) return;
  updateState.checking = true;
  try {
    const latest = await readRemoteVersion();
    if (latest) {
      updateState.latest = latest;
      updateState.available = isNewer(latest, updateState.current);
    }
    // 远端拿不到则保持上次结论(不误报、不误清)
    checkedThisSession = true;
  } finally {
    updateState.checking = false;
  }
}

/** 从构建产物 URL 解析 third-party 下的扩展文件夹名 */
function extensionFolderName(): string {
  try {
    const path = new URL(import.meta.url).pathname;
    const marker = '/third-party/';
    const idx = path.indexOf(marker);
    if (idx >= 0) {
      const folder = path.slice(idx + marker.length).split('/')[0];
      if (folder) return folder;
    }
  } catch {
    // 回退到默认目录名
  }
  return FALLBACK_FOLDER;
}

async function discoverExtensionType(folder: string): Promise<'global' | 'local' | 'system' | null> {
  try {
    const headers = getContext()?.getRequestHeaders?.() ?? {};
    const resp = await fetch('/api/extensions/discover', { method: 'GET', headers, cache: 'no-store' });
    if (!resp.ok) return null;
    const list = (await resp.json()) as Array<{ name?: string; type?: string }>;
    if (!Array.isArray(list)) return null;
    const hit = list.find(x => x?.name === `third-party/${folder}`);
    const type = hit?.type;
    return type === 'global' || type === 'local' || type === 'system' ? type : null;
  } catch {
    return null;
  }
}

/** 执行更新:交给 ST 后端 git pull,成功后自动刷新页面;失败抛错由 UI 提示 */
export async function performUpdate(): Promise<void> {
  if (updateState.updating) return;
  updateState.updating = true;
  try {
    const folder = extensionFolderName();
    const type = await discoverExtensionType(folder);
    const headers = getContext()?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
    const resp = await fetch('/api/extensions/update', {
      method: 'POST',
      headers,
      body: JSON.stringify({ extensionName: folder, global: type === 'global' }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || resp.statusText || `HTTP ${resp.status}`);
    }
    updateState.available = false;
    setTimeout(() => location.reload(), 800);
  } finally {
    updateState.updating = false;
  }
}
