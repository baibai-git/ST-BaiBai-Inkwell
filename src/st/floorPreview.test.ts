import { describe, expect, it } from 'vitest';

import { buildFloorPreview } from '@/st/floorPreview';

describe('floor preview cleanup', () => {
  it('removes thinking blocks while preserving visible text', () => {
    expect(
      buildFloorPreview(
        '<think>内部推理</think>\n正文一\n<reasoning mode="private">更多推理</reasoning>\n正文二',
      ),
    ).toBe('正文一 正文二');
  });

  it('supports alternate tag names, casing, and multiple blocks', () => {
    expect(
      buildFloorPreview(
        '<THINKING>推理一</THINKING><analysis>推理二</analysis><p>有效正文</p>',
      ),
    ).toBe('有效正文');
  });

  it('hides an unfinished thinking block', () => {
    expect(buildFloorPreview('可见正文\n<think>尚未闭合的推理')).toBe('可见正文');
  });

  it('returns a useful placeholder when no visible text remains', () => {
    expect(buildFloorPreview('<think>只有推理</think>')).toBe('（无正文预览）');
  });
});
