/**
 * 确定性伪随机数生成器。
 * 地图生成的关键逻辑只使用这里的 PRNG，绝不使用 Math.random()，
 * 以保证「相同尺寸 + 相同密度 + 相同种子」生成完全相同的地图。
 */

/**
 * 将任意种子输入（数字或短字符串）稳定地哈希为 32 位无符号整数。
 * 纯数字字符串直接按数字处理，其余使用 FNV-1a 哈希。
 */
export function hashSeed(input: string | number | null | undefined): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const n = Math.abs(Math.trunc(input)) >>> 0;
    return n === 0 ? 1 : n;
  }

  const str = String(input ?? '').trim();
  if (str === '') return 1;

  if (/^\d{1,10}$/.test(str)) {
    const n = Number(str) >>> 0;
    if (n !== 0) return n;
  }

  // FNV-1a 32 位
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 1 : h >>> 0;
}

/** Mulberry32：轻量、快速、质量足够的确定性 PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** [0, 1) 浮点数 */
  next(): number;
  /** [0, maxExclusive) 整数 */
  int(maxExclusive: number): number;
  /** [min, max] 闭区间整数 */
  range(min: number, max: number): number;
  /** 随机取一个元素（数组为空时抛错） */
  pick<T>(items: readonly T[]): T;
  /** 原地 Fisher-Yates 洗牌，返回同一数组 */
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive) % maxExclusive;
  };

  return {
    next,
    int,
    range: (min, max) => min + int(max - min + 1),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('createRng.pick: 数组为空');
      }
      return items[int(items.length)]!;
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },
  };
}

/** 生成一个可读的随机种子（用于「随机生成种子」按钮，非地图生成逻辑） */
export function randomSeedString(): string {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
