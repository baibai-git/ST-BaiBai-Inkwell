import { getContext, type STContext, type STMessage } from '@/st/context';
import { openPen } from '@/state/ui';

function findMessage(floor: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#chat .mes[mesid="${floor}"]`);
}

function activeEditorText(floor: number): string | null {
  return findMessage(floor)?.querySelector<HTMLTextAreaElement>('#curEditTextarea')?.value ?? null;
}

export function getFloorSourceText(floor: number): string | null {
  const message = getContext()?.chat?.[floor];
  if (!message) return null;
  return activeEditorText(floor) ?? message.mes ?? '';
}

/** 从楼层列表直接读取聊天数据，不要求该楼层已经渲染到 DOM。 */
export function openFloorInPen(floor: number): boolean {
  const context = getContext();
  const chatMessage = context?.chat?.[floor];
  if (!context || !chatMessage) return false;

  openPen(
    chatMessage.mes ?? '',
    floor,
    chatMessage.name || (chatMessage.is_user ? '你' : 'AI'),
    context.getCurrentChatId?.() ?? '',
  );
  return true;
}

export type ApplyFloorResult = 'saved' | 'chat-changed' | 'floor-changed' | 'unavailable';

interface STScriptModule {
  updateMessageElement?: (
    message: STMessage,
    options: { messageId: number },
  ) => unknown;
}

async function emitMessageEvent(
  context: STContext,
  event: unknown,
  floor: number,
): Promise<void> {
  if (event !== undefined && context.eventSource?.emit) {
    await context.eventSource.emit(event, floor);
  }
}

async function refreshRenderedMessage(
  context: STContext,
  message: STMessage,
  floor: number,
): Promise<void> {
  const existing = findMessage(floor);
  if (!existing) return;

  try {
    const path = '/script.js';
    const st = (await import(/* @vite-ignore */ path)) as STScriptModule;
    if (typeof st.updateMessageElement !== 'function') {
      throw new Error('ST message renderer unavailable');
    }
    const replacement = st.updateMessageElement(message, { messageId: floor });
    $(existing).after(replacement);
    existing.remove();
  } catch {
    await context.reloadCurrentChat?.();
  }
}

/**
 * 直接更新聊天数组并持久化，不要求目标楼层存在于 DOM。
 * 若目标楼层恰好在 ST 编辑态，则以编辑区内容作为并发校验来源。
 */
export async function applyFloorText(
  floor: number,
  expectedText: string,
  nextText: string,
  expectedChatId = '',
): Promise<ApplyFloorResult> {
  const context = getContext();
  if (!context?.saveChat) return 'unavailable';
  if (expectedChatId && context.getCurrentChatId?.() !== expectedChatId) {
    return 'chat-changed';
  }

  const message = context.chat?.[floor];
  if (!message) return 'unavailable';
  const editorText = activeEditorText(floor);
  if ((editorText ?? message.mes) !== expectedText) return 'floor-changed';

  const previousText = message.mes;
  const currentSwipe =
    Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)
      ? message.swipe_id
      : undefined;
  const previousSwipeText =
    currentSwipe !== undefined ? message.swipes?.[currentSwipe] : undefined;

  message.mes = nextText;
  if (currentSwipe !== undefined && message.swipes) {
    message.swipes[currentSwipe] = nextText;
  }

  try {
    await emitMessageEvent(context, context.eventTypes?.MESSAGE_EDITED, floor);
    await refreshRenderedMessage(context, message, floor);
    await emitMessageEvent(context, context.eventTypes?.MESSAGE_UPDATED, floor);
    await context.saveChat();
    return 'saved';
  } catch (error) {
    message.mes = previousText;
    if (currentSwipe !== undefined && message.swipes) {
      message.swipes[currentSwipe] = previousSwipeText ?? previousText;
    }
    await refreshRenderedMessage(context, message, floor).catch(() => undefined);
    throw error;
  }
}
