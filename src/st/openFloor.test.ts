import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyFloorText, getFloorSourceText, openFloorInPen } from '@/st/openFloor';
import { ui } from '@/state/ui';

function installContext(context: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    SillyTavern: {
      getContext: () => context,
    },
  });
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('floor access without rendered messages', () => {
  it('opens a floor directly from the chat array', () => {
    installContext({
      chat: [
        {
          name: '角色',
          is_user: false,
          is_system: true,
          mes: '未渲染的楼层正文',
        },
      ],
      getCurrentChatId: () => 'chat-a',
    });

    expect(openFloorInPen(0)).toBe(true);
    expect(ui.floor).toBe(0);
    expect(ui.originalText).toBe('未渲染的楼层正文');
    expect(ui.chatId).toBe('chat-a');
  });

  it('reads the active editor value before the persisted message text', () => {
    const editor = { value: '编辑器中的正文' };
    vi.stubGlobal('window', {
      SillyTavern: {
        getContext: () => ({
          chat: [{ name: '角色', is_user: false, is_system: false, mes: '已保存正文' }],
        }),
      },
    });
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => ({
        querySelector: vi.fn(() => editor),
      })),
    });

    expect(getFloorSourceText(0)).toBe('编辑器中的正文');
  });

  it('updates the message, current swipe, events, and persisted chat', async () => {
    const emit = vi.fn(async () => undefined);
    const saveChat = vi.fn(async () => undefined);
    const message = {
      name: '角色',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['旧分支', '原文'],
      swipe_id: 1,
    };
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat,
      eventSource: { emit },
      eventTypes: {
        MESSAGE_EDITED: 'edited',
        MESSAGE_UPDATED: 'updated',
      },
    });

    await expect(applyFloorText(0, '原文', '新正文', 'chat-a')).resolves.toBe('saved');
    expect(message.mes).toBe('新正文');
    expect(message.swipes).toEqual(['旧分支', '新正文']);
    expect(emit).toHaveBeenNthCalledWith(1, 'edited', 0);
    expect(emit).toHaveBeenNthCalledWith(2, 'updated', 0);
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('rolls back the message and current swipe when saving fails', async () => {
    const message = {
      name: '角色',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['原文'],
      swipe_id: 0,
    };
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat: vi.fn(async () => {
        throw new Error('保存失败');
      }),
    });

    await expect(applyFloorText(0, '原文', '新正文', 'chat-a')).rejects.toThrow('保存失败');
    expect(message.mes).toBe('原文');
    expect(message.swipes).toEqual(['原文']);
  });
});
