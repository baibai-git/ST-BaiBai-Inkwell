import { describe, expect, it } from 'vitest';
import { isNewer } from '@/api/update';

describe('isNewer', () => {
  it('同段数按数值比较', () => {
    expect(isNewer('0.2', '0.1')).toBe(true);
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1', '0.2')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });

  it('缺段补 0,0.1 与 0.1.x 可互比', () => {
    expect(isNewer('0.1.1', '0.1')).toBe(true);
    expect(isNewer('0.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.1')).toBe(false);
  });

  it('相等或空值不算更新', () => {
    expect(isNewer('0.1', '0.1')).toBe(false);
    expect(isNewer('', '0.1')).toBe(false);
    expect(isNewer('0.1', '')).toBe(false);
  });

  it('非数字段按 0 处理', () => {
    expect(isNewer('0.1.x', '0.1')).toBe(false);
    expect(isNewer('0.2', '0.1.x')).toBe(true);
  });
});
