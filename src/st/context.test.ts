import { describe, expect, it } from 'vitest';

import { getOpenChatId, type STContext } from '@/st/context';

function contextWithChatId(chatId: string | undefined): STContext {
  return {
    chat: [],
    name1: 'User',
    name2: 'Char',
    getRequestHeaders: () => ({}),
    getCurrentChatId: () => chatId,
  };
}

describe('open chat detection', () => {
  it('treats the welcome page as having no open chat', () => {
    expect(getOpenChatId(contextWithChatId(undefined))).toBe('');
    expect(getOpenChatId(contextWithChatId('   '))).toBe('');
  });

  it('returns the trimmed active chat id', () => {
    expect(getOpenChatId(contextWithChatId(' chat-a '))).toBe('chat-a');
  });
});
