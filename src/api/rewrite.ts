import {
  requestCompletion,
  requestViaMainApi,
  type ChatMessage,
} from '@/api/client';
import type { ApiChannel } from '@/api/sharedChannels';
import { collectRewriteStoryContext } from '@/api/storyContext';
import { splitParagraphs } from '@/state/ui';
import { jsonrepair } from 'jsonrepair';

export interface ParagraphAnnotation {
  paragraph: number;
  text: string;
  instructions: string[];
}

export interface RewriteRequest {
  floor: number;
  originalText: string;
  annotations: ParagraphAnnotation[];
  generalInstructions: string[];
  contextRounds: number;
  channel: ApiChannel | null;
  signal?: AbortSignal;
}

export interface RewriteResult {
  changes: RewriteChange[];
  historyMessageCount: number;
  contextParts: {
    charCard: boolean;
    persona: boolean;
    worldInfo: boolean;
  };
}

export interface RewriteChange {
  paragraph: number;
  replacement: string;
}

function systemBlock(title: string, description: string, content: string): string {
  return `【${title}】\n${description}\n\n${content.trim()}`;
}

function buildInstruction(request: RewriteRequest): string {
  const annotations = request.annotations
    .map(annotation => {
      const requirements = annotation.instructions
        .map(instruction => instruction.trim())
        .filter(Boolean)
        .map(instruction => `  - ${instruction}`)
        .join('\n');
      return `第 ${annotation.paragraph} 段：\n原文：${annotation.text}\n要求：\n${requirements}`;
    })
    .join('\n\n');
  const general = request.generalInstructions
    .map(instruction => instruction.trim())
    .filter(Boolean)
    .map(instruction => `- ${instruction}`)
    .join('\n');

  const paragraphs = splitParagraphs(request.originalText)
    .map(paragraph => `[P${paragraph.id}]\n${paragraph.text}`)
    .join('\n\n');

  return `请根据标注生成当前楼层的段落替换补丁。

规则：
1. 标注段落是主要修改目标。
2. 如果标注修改影响后文，可以修改未标注段落，但必须把每个关联段落作为独立补丁返回。
3. 只返回实际需要修改的段落，未修改段落绝对不要返回。
4. 当前楼层以每个非空行为一个段落，不得合并、拆分、增加或重新排列段落。
5. replacement 必须是该行替换后的完整文本，不得包含换行、[P编号]、解释或修改说明。
6. 如果用户明确要求删除整个段落，返回该段编号并把 replacement 设为空字符串 ""。
7. 与标注无关的内容保持原样，不要无目的扩写、删减或改变剧情。
8. 保持人物身份、叙述视角、文风、Markdown、HTML 和原有特殊标记。
9. 历史上下文、角色设定、主角设定和世界设定都只用于理解，绝不能改写或复述。
10. 只输出一个合法 JSON 对象，不要使用代码块，也不要输出 JSON 之外的任何文字。

输出格式：
{"changes":[{"paragraph":2,"replacement":"第 2 段替换后的完整文本"},{"paragraph":4,"replacement":"第 4 段替换后的完整文本"}]}

【整体要求】
${general || '无'}

【段落标注】
${annotations || '无'}

【当前楼层按行分段】
${paragraphs}`;
}

function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const content = (fenced?.[1] ?? text).trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 未返回合法的段落补丁 JSON');
  const candidate = content.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      throw new Error('AI 返回的段落补丁 JSON 无法解析');
    }
  }
}

export function parseChanges(raw: string, originalText: string): RewriteChange[] {
  const parsed = extractJsonObject(raw);
  const list =
    parsed && typeof parsed === 'object'
      ? (parsed as { changes?: unknown }).changes
      : undefined;
  if (!Array.isArray(list)) throw new Error('AI 返回结果缺少 changes 数组');

  const paragraphs = splitParagraphs(originalText);
  const byParagraph = new Map<number, RewriteChange>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const paragraph = Number((item as { paragraph?: unknown }).paragraph);
    const rawReplacement = (item as { replacement?: unknown }).replacement;
    if (!Number.isInteger(paragraph) || paragraph < 1 || paragraph > paragraphs.length) continue;
    if (typeof rawReplacement !== 'string') continue;
    const replacement = rawReplacement.trim() ? rawReplacement : '';
    if (/[\r\n]/.test(replacement)) continue;
    if (replacement && replacement.trim() === paragraphs[paragraph - 1].text) continue;
    byParagraph.set(paragraph, { paragraph, replacement });
  }
  const changes = [...byParagraph.values()].sort((left, right) => left.paragraph - right.paragraph);
  if (!changes.length) throw new Error('AI 没有返回任何有效的段落修改');
  return changes;
}

export async function rewriteCurrentFloor(request: RewriteRequest): Promise<RewriteResult> {
  const story = await collectRewriteStoryContext(
    request.floor,
    request.originalText,
    request.contextRounds,
  );
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是小说与角色扮演文本改写助手。你必须按用户标注返回段落级替换补丁，不能返回当前楼层全文。',
    },
  ];
  if (story.charCard) {
    messages.push({
      role: 'system',
      content: systemBlock(
        '角色设定（角色卡设定，只读参考）',
        '以下是当前角色的人物设定，用于理解角色言行；它不是本轮发生的事。',
        story.charCard,
      ),
    });
  }
  if (story.persona) {
    messages.push({
      role: 'system',
      content: systemBlock(
        '主角设定（用户操控的主角本人设定，只读参考）',
        '以下是对话中用户一方的人物设定，用于理解主角身份与言行；它不是本轮发生的事。',
        story.persona,
      ),
    });
  }
  if (story.worldInfo) {
    messages.push({
      role: 'system',
      content: systemBlock(
        '世界设定（世界书激活的相关设定，只读参考）',
        '务必与以下设定保持一致，不得编造与其矛盾的内容。',
        story.worldInfo,
      ),
    });
  }
  messages.push(...story.history);
  messages.push({ role: 'user', content: buildInstruction(request) });

  const raw = request.channel
    ? await requestCompletion(request.channel, messages, request.signal)
    : await requestViaMainApi(messages, request.signal);
  return {
    changes: parseChanges(raw, request.originalText),
    historyMessageCount: story.historyMessageCount,
    contextParts: {
      charCard: !!story.charCard,
      persona: !!story.persona,
      worldInfo: !!story.worldInfo,
    },
  };
}
