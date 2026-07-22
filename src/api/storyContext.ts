import type { ChatMessage } from '@/api/client';
import {
  getCheckWorldInfo,
  getContext,
  getEjsTemplate,
  type STMessage,
  type WorldInfoEntry,
} from '@/st/context';

const HUGE_WORLD_INFO_CONTEXT = 1_000_000_000;
const THINK_BLOCK = /<think(?:ing)?\b[\s\S]*?<\/think(?:ing)?>/gi;
const BOOK_SETTINGS_KEY = 'baibai_book';

export interface RewriteStoryContext {
  history: ChatMessage[];
  worldInfo: string;
  charCard: string;
  persona: string;
  historyMessageCount: number;
}

function cleanForWorldInfo(message: string): string {
  let text = String(message ?? '')
    .replace(THINK_BLOCK, '')
    .replace(/<!--[\s\S]+?-->/g, '')
    .replace(/<horae[\s\S]*?>[\s\S]*?<\/horae[\s\S]*?>/gi, '');
  const starts = [...text.matchAll(/<bbs_start\b/gi)];
  const lastStart = starts.at(-1)?.index;
  if (lastStart !== undefined) text = text.slice(lastStart);
  const end = text.match(/<\/bbs_end>/i);
  if (end?.index !== undefined) text = text.slice(0, end.index + end[0].length);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function selectHistoryIndices(chat: STMessage[], floor: number, rounds: number): number[] {
  const selected: number[] = [];
  let cursor = floor;
  for (let round = 0; round < rounds; round += 1) {
    let userIndex = -1;
    for (let index = cursor - 1; index >= 0; index -= 1) {
      const message = chat[index];
      if (message && message.is_user && !message.is_system) {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) break;

    let aiIndex = -1;
    for (let index = userIndex - 1; index >= 0; index -= 1) {
      const message = chat[index];
      if (message && !message.is_user && !message.is_system) {
        aiIndex = index;
        break;
      }
    }
    selected.unshift(userIndex);
    if (aiIndex >= 0) {
      selected.unshift(aiIndex);
      cursor = aiIndex;
    } else {
      break;
    }
  }
  return selected;
}

function joinWorldInfoChunks(chunks: string[]): string {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const chunk of chunks) {
    const text = chunk?.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      output.push(text);
    }
  }
  return output.join('\n\n').trim();
}

interface BookWorldInfoSettings {
  excludedWorldNames: string[];
  excludedWorldInfoPatterns: string[];
  renderWorldInfoTemplates: boolean;
}

function bookWorldInfoSettings(): BookWorldInfoSettings {
  const raw = getContext()?.extensionSettings?.[BOOK_SETTINGS_KEY];
  const value = raw && typeof raw === 'object'
    ? (raw as {
      excludedWorldNames?: unknown;
      excludedWorldInfoPatterns?: unknown;
      renderWorldInfoTemplates?: unknown;
    })
    : {};
  return {
    excludedWorldNames: Array.isArray(value.excludedWorldNames)
      ? value.excludedWorldNames.filter((item): item is string => typeof item === 'string')
      : [],
    excludedWorldInfoPatterns: Array.isArray(value.excludedWorldInfoPatterns)
      ? value.excludedWorldInfoPatterns.filter((item): item is string => typeof item === 'string')
      : [],
    renderWorldInfoTemplates:
      typeof value.renderWorldInfoTemplates === 'boolean'
        ? value.renderWorldInfoTemplates
        : true,
  };
}

function isWorldInfoEntryExcluded(
  entry: WorldInfoEntry,
  settings: BookWorldInfoSettings,
): boolean {
  const world = entry.world?.trim();
  if (world && settings.excludedWorldNames.includes(world)) return true;
  const comment = entry.comment?.trim();
  if (!comment) return false;
  for (const raw of settings.excludedWorldInfoPatterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    try {
      if (new RegExp(pattern, 'i').test(comment)) return true;
    } catch {
      if (comment.toLowerCase().includes(pattern.toLowerCase())) return true;
    }
  }
  return false;
}

async function renderWorldInfoContent(
  content: string,
  entry?: WorldInfoEntry,
  floor?: number,
): Promise<string> {
  if (!bookWorldInfoSettings().renderWorldInfoTemplates) return content;
  const context = getContext();
  let text =
    typeof context?.substituteParams === 'function'
      ? context.substituteParams(content)
      : content;
  if (!text.includes('<%')) return text;
  const ejs = getEjsTemplate();
  if (!ejs) return text;
  try {
    const environment = await ejs.prepareContext({ world_info: entry }, floor);
    const output = await ejs.evalTemplate(text, environment);
    if (typeof output === 'string') text = output;
  } catch (error) {
    console.log('[柏宝砚] 世界书 EJS 渲染失败，使用宏展开后的文本：', error);
  }
  return text;
}

async function fetchWorldInfoViaPrompt(scanText: string[], floor: number): Promise<string> {
  const prompt = getContext()?.getWorldInfoPrompt;
  if (typeof prompt !== 'function') return '';
  const result = await prompt(scanText, HUGE_WORLD_INFO_CONTEXT, true);
  if (!result) return '';
  const chunks: string[] = [];
  if (typeof result.worldInfoBefore === 'string') chunks.push(result.worldInfoBefore);
  if (typeof result.worldInfoAfter === 'string') chunks.push(result.worldInfoAfter);
  for (const depth of result.worldInfoDepth ?? []) {
    for (const entry of depth.entries ?? []) if (typeof entry === 'string') chunks.push(entry);
  }
  for (const entry of result.anBefore ?? []) if (typeof entry === 'string') chunks.push(entry);
  for (const entry of result.anAfter ?? []) if (typeof entry === 'string') chunks.push(entry);
  return joinWorldInfoChunks(
    await Promise.all(chunks.map(chunk => renderWorldInfoContent(chunk, undefined, floor))),
  );
}

async function fetchWorldInfo(scanText: string[], floor: number): Promise<string> {
  if (!scanText.length) return '';
  try {
    const checkWorldInfo = await getCheckWorldInfo();
    if (!checkWorldInfo) return await fetchWorldInfoViaPrompt(scanText, floor);
    const result = await checkWorldInfo(scanText, HUGE_WORLD_INFO_CONTEXT, true);
    const activated = result?.allActivatedEntries;
    if (!activated) return '';
    const entries = activated instanceof Map ? [...activated.values()] : [...activated];
    const settings = bookWorldInfoSettings();
    return joinWorldInfoChunks(
      await Promise.all(
        entries
          .filter(entry => entry && !isWorldInfoEntryExcluded(entry, settings))
          .map(entry =>
            renderWorldInfoContent(
              typeof entry.content === 'string' ? entry.content : '',
              entry,
              floor,
            ),
          ),
      ),
    );
  } catch (error) {
    console.log('[柏宝砚] 世界书激活失败，继续执行不带世界书的改写：', error);
    return '';
  }
}

function fetchCharCard(): string {
  const context = getContext();
  if (!context || context.groupId) return '';
  const characterId = context.characterId;
  if (characterId === undefined || characterId === null || characterId === '') return '';
  const character = context.characters?.[Number(characterId)];
  if (!character) return '';
  const substitute =
    typeof context.substituteParams === 'function'
      ? context.substituteParams
      : (value: string) => value;
  const fields: Array<[string, string]> = [
    ['描述', String(character.description ?? '')],
    ['性格', String(character.personality ?? '')],
    ['情景', String(character.scenario ?? '')],
  ];
  return fields
    .map(([label, raw]) => {
      const value = substitute(raw).trim();
      return value ? `【${label}】\n${value}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function fetchUserPersona(): string {
  const context = getContext();
  if (!context || typeof context.substituteParams !== 'function') return '';
  return context.substituteParams('{{persona}}').trim();
}

export async function collectRewriteStoryContext(
  floor: number,
  currentText: string,
  contextRounds: number,
): Promise<RewriteStoryContext> {
  const context = getContext();
  if (!context) throw new Error('SillyTavern 上下文不可用');
  const indices = selectHistoryIndices(context.chat, floor, contextRounds);
  const history = indices
    .map(index => context.chat[index])
    .filter((message): message is STMessage => !!message)
    .map<ChatMessage>(message => ({
      role: message.is_user ? 'user' : 'assistant',
      content: message.mes,
    }));
  const scanText = [
    ...indices.map(index => {
      const message = context.chat[index];
      const name = message?.is_user
        ? context.name1 || 'User'
        : message?.name || context.name2 || 'Char';
      return message ? `${name}: ${cleanForWorldInfo(message.mes)}` : '';
    }),
    `${context.name2 || 'Char'}: ${cleanForWorldInfo(currentText)}`,
  ].filter(Boolean);

  const [worldInfo] = await Promise.all([fetchWorldInfo(scanText, floor)]);
  return {
    history,
    worldInfo,
    charCard: fetchCharCard(),
    persona: fetchUserPersona(),
    historyMessageCount: history.length,
  };
}
