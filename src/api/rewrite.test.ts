import { describe, expect, it } from 'vitest';

import { parseChanges } from '@/api/rewrite';

describe('parseChanges', () => {
  it('repairs a missing closing quote in a replacement string', () => {
    const originalText = Array.from({ length: 42 }, (_, index) => `原段落 ${index + 1}`).join(
      '\n\n',
    );
    const raw =
      '{"changes":[{"paragraph":42,"replacement":"“车里有早报。”他把钥匙揣进花衬衫宽大的口袋里，手指在门框上敲了两下，“你要是能在太平山绕完两个弯之前走到车里，晚上那顿潮州打冷，算我的。”}]}';

    expect(parseChanges(raw, originalText)).toEqual([
      {
        paragraph: 42,
        replacement:
          '“车里有早报。”他把钥匙揣进花衬衫宽大的口袋里，手指在门框上敲了两下，“你要是能在太平山绕完两个弯之前走到车里，晚上那顿潮州打冷，算我的。”',
      },
    ]);
  });

  it('still rejects repaired JSON without a string replacement', () => {
    const raw = '{"changes":[{"paragraph":1,"replacement":123,}]}';

    expect(() => parseChanges(raw, '原段落')).toThrow('AI 没有返回任何有效的段落修改');
  });

  it('rejects a replacement containing a line break', () => {
    const raw = '{"changes":[{"paragraph":1,"replacement":"第一行\\n第二行"}]}';

    expect(() => parseChanges(raw, '原段落')).toThrow('AI 没有返回任何有效的段落修改');
  });
});
