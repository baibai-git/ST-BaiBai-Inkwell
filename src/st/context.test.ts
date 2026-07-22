import { describe, expect, it } from 'vitest';

import { getOpenChatId, getOpenChatIdentity, type STContext } from '@/st/context';

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

  it('includes the character or group scope in the chat identity', () => {
    const characterContext = contextWithChatId('chat-a');
    characterContext.characterId = 0;
    characterContext.characters = [{ name: 'Char', avatar: 'char.png' }];
    expect(getOpenChatIdentity(characterContext)).toBe('character:char.png\u0000chat-a');

    const groupContext = contextWithChatId('chat-a');
    groupContext.groupId = 'group-1';
    expect(getOpenChatIdentity(groupContext)).toBe('group:group-1\u0000chat-a');
  });
});
