import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_DIFFICULTY } from '../game/constants';
import {
  applyResult,
  configSignature,
  getRecord,
  hasAnyImprovement,
  type RecordBook,
} from '../game/records';
import type { MapConfig } from '../game/types';

const base: MapConfig = DEFAULT_CONFIG;

const win = (elapsedMs: number, moves: number, routeEfficiency: number) => ({
  won: true,
  elapsedMs,
  moves,
  routeEfficiency,
  now: 1000,
});

describe('配置签名', () => {
  it('种子不参与签名：换种子仍然是同一种挑战', () => {
    expect(configSignature({ ...base, seed: 'a' })).toBe(configSignature({ ...base, seed: 'b' }));
  });

  it('尺寸、密度、岩块、生命、难度修正项都会改变签名', () => {
    const signature = configSignature(base);
    expect(configSignature({ ...base, dims: { x: 7, y: 6, z: 6 } })).not.toBe(signature);
    expect(configSignature({ ...base, mineDensity: 0.2 })).not.toBe(signature);
    expect(configSignature({ ...base, rockDensity: 0.1 })).not.toBe(signature);
    expect(configSignature({ ...base, lives: 5 })).not.toBe(signature);
    expect(
      configSignature({
        ...base,
        difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false },
      }),
    ).not.toBe(signature);
    expect(
      configSignature({
        ...base,
        difficulty: { ...DEFAULT_DIFFICULTY, showOrthogonalCount: true },
      }),
    ).not.toBe(signature);
  });

  it('非立方体地图的三个方向不会互相混淆', () => {
    expect(configSignature({ ...base, dims: { x: 7, y: 4, z: 5 } })).not.toBe(
      configSignature({ ...base, dims: { x: 5, y: 4, z: 7 } }),
    );
  });
});

describe('记录累积', () => {
  it('第一次通关会记下全部三项纪录', () => {
    const { book, improvements, record } = applyResult({}, base, win(60_000, 20, 0.8));
    expect(improvements.firstWin).toBe(true);
    expect(improvements.time).toBe(true);
    expect(improvements.efficiency).toBe(true);
    expect(improvements.moves).toBe(true);
    expect(record.wins).toBe(1);
    expect(record.losses).toBe(0);
    expect(record.bestTimeMs).toBe(60_000);
    expect(record.bestMoves).toBe(20);
    expect(record.bestEfficiency).toBe(0.8);
    expect(getRecord(book, base)).toEqual(record);
  });

  it('更快的一局刷新用时纪录，更慢的不会', () => {
    let book: RecordBook = applyResult({}, base, win(60_000, 20, 0.8)).book;
    const faster = applyResult(book, base, win(40_000, 25, 0.6));
    expect(faster.improvements.time).toBe(true);
    expect(faster.improvements.moves).toBe(false);
    expect(faster.improvements.efficiency).toBe(false);
    expect(faster.record.bestTimeMs).toBe(40_000);
    // 步数与效率保留旧纪录
    expect(faster.record.bestMoves).toBe(20);
    expect(faster.record.bestEfficiency).toBe(0.8);

    book = faster.book;
    const slower = applyResult(book, base, win(90_000, 30, 0.5));
    expect(hasAnyImprovement(slower.improvements)).toBe(false);
    expect(slower.record.bestTimeMs).toBe(40_000);
    expect(slower.record.wins).toBe(3);
  });

  it('失败只累加负场，不影响最佳成绩', () => {
    const book = applyResult({}, base, win(60_000, 20, 0.8)).book;
    const lost = applyResult(book, base, {
      won: false,
      elapsedMs: 10_000,
      moves: 3,
      routeEfficiency: 1,
      now: 2000,
    });
    expect(hasAnyImprovement(lost.improvements)).toBe(false);
    expect(lost.record.losses).toBe(1);
    expect(lost.record.wins).toBe(1);
    expect(lost.record.bestTimeMs).toBe(60_000);
    expect(lost.record.bestMoves).toBe(20);
  });

  it('不同配置的记录互不干扰', () => {
    const hard: MapConfig = { ...base, lives: 1 };
    let book = applyResult({}, base, win(60_000, 20, 0.8)).book;
    book = applyResult(book, hard, win(30_000, 10, 0.9)).book;
    expect(getRecord(book, base)!.bestTimeMs).toBe(60_000);
    expect(getRecord(book, hard)!.bestTimeMs).toBe(30_000);
    expect(Object.keys(book)).toHaveLength(2);
  });

  it('applyResult 不会修改传入的记录簿', () => {
    const book: RecordBook = {};
    const snapshot = JSON.stringify(book);
    applyResult(book, base, win(60_000, 20, 0.8));
    expect(JSON.stringify(book)).toBe(snapshot);
  });

  it('没有记录时 getRecord 返回 null', () => {
    expect(getRecord({}, base)).toBeNull();
  });
});
