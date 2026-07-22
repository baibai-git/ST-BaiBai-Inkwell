export interface STMessage {
  name: string;
  is_user: boolean;
  is_system: boolean;
  mes: string;
  swipes?: string[];
  swipe_id?: number;
  extra?: Record<string, unknown>;
}

export interface STCharacter {
  name: string;
  avatar: string;
  description?: string;
  personality?: string;
  scenario?: string;
  [key: string]: unknown;
}

export interface STContext {
  chat: STMessage[];
  name1: string;
  name2: string;
  characters?: STCharacter[];
  characterId?: string | number;
  groupId?: string;
  maxContext?: number;
  extensionSettings?: Record<string, unknown>;
  saveSettingsDebounced?: () => void;
  getRequestHeaders: () => Record<string, string>;
  getCurrentChatId?: () => string | undefined;
  substituteParams?: (content: string) => string;
  generateRaw?: (params: {
    prompt: Array<{ role: string; content: string }> | string;
    responseLength?: number | null;
  }) => Promise<string>;
  getWorldInfoPrompt?: (
    chat: string[],
    maxContext: number,
    isDryRun: boolean,
    globalScanData?: Record<string, unknown>,
  ) => Promise<{
    worldInfoBefore?: string;
    worldInfoAfter?: string;
    worldInfoString?: string;
    worldInfoDepth?: Array<{ depth?: number; role?: number; entries?: string[] }>;
    anBefore?: string[];
    anAfter?: string[];
  }>;
}

interface STGlobal {
  getContext: () => STContext;
}

declare global {
  interface Window {
    SillyTavern?: STGlobal;
  }
}

export function getContext(): STContext | null {
  try {
    return window.SillyTavern?.getContext?.() ?? null;
  } catch {
    return null;
  }
}

export interface WorldInfoEntry {
  world?: string;
  comment?: string;
  content?: string;
  [key: string]: unknown;
}

interface CheckWorldInfoResult {
  allActivatedEntries?: Set<WorldInfoEntry> | Map<string, WorldInfoEntry>;
  [key: string]: unknown;
}

type CheckWorldInfoFn = (
  chat: string[],
  maxContext: number,
  isDryRun: boolean,
  globalScanData?: Record<string, unknown>,
) => Promise<CheckWorldInfoResult>;

export async function getCheckWorldInfo(): Promise<CheckWorldInfoFn | null> {
  try {
    const path = '/scripts/world-info.js';
    const module = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    return typeof module.checkWorldInfo === 'function'
      ? (module.checkWorldInfo as CheckWorldInfoFn)
      : null;
  } catch {
    return null;
  }
}

export interface EjsTemplateApi {
  prepareContext: (context?: Record<string, unknown>, end?: number) => Promise<Record<string, unknown>>;
  evalTemplate: (
    code: string,
    context?: Record<string, unknown> | null,
    options?: Record<string, unknown>,
  ) => Promise<string | null>;
}

export function getEjsTemplate(): EjsTemplateApi | null {
  const api = (globalThis as { EjsTemplate?: Partial<EjsTemplateApi> }).EjsTemplate;
  if (api && typeof api.prepareContext === 'function' && typeof api.evalTemplate === 'function') {
    return api as EjsTemplateApi;
  }
  return null;
}
