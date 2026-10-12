import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, mulberry32 } from '../game/seededRandom';

describe('种子哈希', () => {
  it('相同输入得到相同种子', () => {
    expect(hashSeed('minecube')).toBe(hashSeed('minecube'));
    expect(hashSeed('12345')).toBe(hashSeed('12345'));
  });

  it('不同字符串通常得到不同种子', () => {
    expect(hashSeed('minecube')).not.toBe(hashSeed('minecuba'));
    expect(hashSeed('abc')).not.toBe(hashSeed('cba'));
  });

  it('空种子有稳定的兜底值，不会得到 NaN', () => {
    expect(hashSeed('')).toBe(1);
    expect(hashSeed('   ')).toBe(1);
    expect(hashSeed(null)).toBe(1);
    expect(hashSeed(undefined)).toBe(1);
    expect(Number.isFinite(hashSeed('雷区'))).toBe(true);
  });

  it('数字与等价的数字字符串得到相同种子', () => {
    expect(hashSeed(42)).toBe(hashSeed('42'));
  });

  it('结果始终是 32 位无符号整数', () => {
    for (const seed of ['a', 'minecube', '999999', '三维扫雷', 'x'.repeat(64)]) {
      const value = hashSeed(seed);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('Mulberry32', () => {
  it('相同种子产生相同序列', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 100; i += 1) expect(a()).toBe(b());
  });

  it('不同种子产生不同序列', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('输出落在 [0, 1) 区间内', () => {
    const rand = mulberry32(987654);
    for (let i = 0; i < 1000; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Rng 工具', () => {
  it('int 落在 [0, max) 范围内', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const v = rng.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('shuffle 是确定性的且保留全部元素', () => {
    const source = Array.from({ length: 30 }, (_, i) => i);
    const a = createRng(99).shuffle(source.slice());
    const b = createRng(99).shuffle(source.slice());
    expect(a).toEqual(b);
    expect(a.slice().sort((m, n) => m - n)).toEqual(source);
  });

  it('不同种子的 shuffle 结果通常不同', () => {
    const source = Array.from({ length: 30 }, (_, i) => i);
    expect(createRng(1).shuffle(source.slice())).not.toEqual(createRng(2).shuffle(source.slice()));
  });
});
