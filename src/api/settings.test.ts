import { describe, expect, it } from 'vitest';

import { DEFAULT_QUICK_PHRASES, normalizePenSettings } from '@/api/settings';

describe('theme settings', () => {
  it('restores a persisted theme', () => {
    expect(normalizePenSettings({ theme: 'green' }).theme).toBe('green');
  });

  it('uses the day theme for legacy or invalid settings', () => {
    expect(normalizePenSettings({}).theme).toBe('day');
    expect(normalizePenSettings({ theme: 'unknown' }).theme).toBe('day');
  });
});

describe('default quick phrases', () => {
  it('installs the built-in phrases for settings without a defaults version', () => {
    expect(normalizePenSettings({ phrases: [] }).phrases).toEqual(DEFAULT_QUICK_PHRASES);
  });

  it('preserves the saved phrase list after defaults have been installed', () => {
    const phrases = [
      {
        id: 99,
        name: '自定义',
        instruction: '保留这条',
        favorite: true,
      },
    ];

    expect(
      normalizePenSettings({
        quickPhraseDefaultsVersion: 1,
        phrases,
      }).phrases,
    ).toEqual(phrases);
  });

  it('allows users to keep an intentionally empty phrase list', () => {
    expect(
      normalizePenSettings({
        quickPhraseDefaultsVersion: 1,
        phrases: [],
      }).phrases,
    ).toEqual([]);
  });
});

describe('replace rules', () => {
  it('starts with an empty rule library', () => {
    expect(normalizePenSettings({}).replaceRules).toEqual([]);
  });

  it('removes the two legacy placeholder rules and preserves user rules', () => {
    const customRule = {
      id: 9,
      name: '自定义规则',
      pattern: '旧名',
      replacement: '新名',
      isRegex: false,
      enabled: true,
    };

    expect(
      normalizePenSettings({
        replaceRules: [
          {
            id: 1,
            name: '统一省略号',
            pattern: '\\.{3,}',
            replacement: '……',
            isRegex: true,
            enabled: true,
          },
          {
            id: 2,
            name: '清理行尾空白',
            pattern: '[ \\t]+$',
            replacement: '',
            isRegex: true,
            enabled: false,
          },
          customRule,
        ],
      }).replaceRules,
    ).toEqual([customRule]);
  });
});
