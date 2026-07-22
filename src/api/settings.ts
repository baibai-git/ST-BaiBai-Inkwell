import { getContext } from '@/st/context';
import { reactive, watch } from 'vue';

export interface QuickPhrase {
  id: number;
  name: string;
  instruction: string;
  favorite: boolean;
}

export interface PenSettings {
  defaultChannelId: string;
  defaultContextRounds: number;
  phrases: QuickPhrase[];
}

const SETTINGS_KEY = 'baibai_pen';

function defaults(): PenSettings {
  return {
    defaultChannelId: '',
    defaultContextRounds: 1,
    phrases: [],
  };
}

function normalize(raw: unknown): PenSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<PenSettings>) : {};
  return {
    defaultChannelId: typeof value.defaultChannelId === 'string' ? value.defaultChannelId : '',
    defaultContextRounds:
      typeof value.defaultContextRounds === 'number' && Number.isFinite(value.defaultContextRounds)
        ? Math.min(10, Math.max(0, Math.floor(value.defaultContextRounds)))
        : 1,
    phrases: Array.isArray(value.phrases)
      ? value.phrases
        .filter(item => item && typeof item === 'object')
        .map(item => {
          const phrase = item as Partial<QuickPhrase>;
          return {
            id: typeof phrase.id === 'number' ? phrase.id : Date.now() + Math.random(),
            name: typeof phrase.name === 'string' ? phrase.name : '',
            instruction: typeof phrase.instruction === 'string' ? phrase.instruction : '',
            favorite: phrase.favorite === true,
          };
        })
        .filter(item => item.name.trim() && item.instruction.trim())
      : [],
  };
}

export const penSettings = reactive<PenSettings>(defaults());

let ready = false;

function persist(): void {
  const context = getContext();
  if (!context?.extensionSettings) return;
  context.extensionSettings[SETTINGS_KEY] = JSON.parse(JSON.stringify(penSettings));
  context.saveSettingsDebounced?.();
}

export async function initializePenSettings(): Promise<void> {
  if (ready) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const context = getContext();
    if (context?.extensionSettings) {
      Object.assign(penSettings, normalize(context.extensionSettings[SETTINGS_KEY]));
      context.extensionSettings[SETTINGS_KEY] = JSON.parse(JSON.stringify(penSettings));
      context.saveSettingsDebounced?.();
      ready = true;
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  ready = true;
}

watch(
  penSettings,
  () => {
    if (ready) persist();
  },
  { deep: true },
);
