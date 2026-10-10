import { describe, expect, it } from 'vitest';
import { createMapFromMines } from '../game/mapGenerator';
import { positionToIndex } from '../game/neighbors';
import { getCellVisual, isInFocus } from '../game/selectors';
import type { Cell, Dims, Position, SliceState } from '../game/types';

const SIZE: Dims = { x: 4, y: 4, z: 4 };
const START: Position = { x: 0, y: 0, z: 0 };
const END: Position = { x: 3, y: 0, z: 0 };
const MINE: Position = { x: 1, y: 1, z: 0 };
const idx = (p: Position) => positionToIndex(SIZE, p);

const map = createMapFromMines(SIZE, new Set([idx(MINE)]), START, END);
const cellAt = (p: Position): Cell => map.cells[idx(p)]!;
const fullSlice: SliceState = { axis: 'none', level: 0, onlyExplored: false, focusRadius: 0 };

const visualOf = (p: Position, overrides: Partial<Parameters<typeof getCellVisual>[1]> = {}) =>
  getCellVisual(cellAt(p), {
    player: { x: 2, y: 2, z: 2 },
    start: START,
    end: END,
    slice: fullSlice,
    revealAllMines: false,
    ...overrides,
  });

describe('揭示阶段的旗帜判定', () => {
  const revealOptions = {
    player: { x: 2, y: 2, z: 2 },
    start: START,
    end: END,
    slice: fullSlice,
    revealAllMines: true,
  };

  it('插旗且确实是雷 -> 标对了', () => {
    const flaggedMine = { ...cellAt(MINE), mark: 'flag' as const };
    const visual = getCellVisual(flaggedMine, revealOptions);
    expect(visual.kind).toBe('flag-correct');
    expect(visual.label).toBe('flag-ok');
  });

  it('插了旗但那里没有雷 -> 标错了', () => {
    const target: Position = { x: 3, y: 3, z: 3 };
    const flaggedSafe = { ...cellAt(target), mark: 'flag' as const };
    const visual = getCellVisual(flaggedSafe, revealOptions);
    expect(visual.kind).toBe('flag-wrong');
    expect(visual.label).toBe('flag-bad');
  });

  it('没插旗的雷 -> 漏掉的雷', () => {
    const visual = getCellVisual(cellAt(MINE), revealOptions);
    expect(visual.kind).toBe('mine');
    expect(visual.label).toBe('mine');
  });

  it('踩过的雷旗帜已被清掉，显示为漏掉的雷', () => {
    const stepped = { ...cellAt(MINE), revealedMine: true, mark: 'none' as const };
    expect(getCellVisual(stepped, revealOptions).kind).toBe('mine');
  });

  it('游戏进行中插旗只显示普通旗帜，不泄露对错', () => {
    const flaggedMine = { ...cellAt(MINE), mark: 'flag' as const };
    const flaggedSafe = { ...cellAt({ x: 3, y: 3, z: 3 }), mark: 'flag' as const };
    const playing = { ...revealOptions, revealAllMines: false };
    expect(getCellVisual(flaggedMine, playing).kind).toBe('flag');
    expect(getCellVisual(flaggedSafe, playing).kind).toBe('flag');
    expect(getCellVisual(flaggedMine, playing).label).toBe('flag');
  });
});

describe('聚焦半径', () => {
  const PLAYER: Position = { x: 2, y: 2, z: 2 };
  const focusSlice = (focusRadius: number): SliceState => ({
    axis: 'none',
    level: 0,
    onlyExplored: false,
    focusRadius,
  });

  it('isInFocus 用切比雪夫距离判定，0 表示不限制', () => {
    expect(isInFocus({ x: 3, y: 3, z: 3 }, PLAYER, 1)).toBe(true);
    expect(isInFocus({ x: 4, y: 2, z: 2 }, PLAYER, 1)).toBe(false);
    expect(isInFocus({ x: 4, y: 2, z: 2 }, PLAYER, 2)).toBe(true);
    // 半径为 0 时任何格子都在范围内
    expect(isInFocus({ x: 0, y: 0, z: 0 }, PLAYER, 0)).toBe(true);
  });

  it('半径 1 时只有玩家周围 3×3×3 可见', () => {
    const slice = focusSlice(1);
    // 相邻格可见
    expect(visualOf({ x: 3, y: 2, z: 2 }, { player: PLAYER, slice }).visible).toBe(true);
    // 斜对角也在 3×3×3 内
    expect(visualOf({ x: 3, y: 3, z: 3 }, { player: PLAYER, slice }).visible).toBe(true);
    // 距离 2 的格子被隐藏
    expect(visualOf({ x: 0, y: 2, z: 2 }, { player: PLAYER, slice }).visible).toBe(false);
  });

  it('起点和终点作为导航锚点始终保留', () => {
    const slice = focusSlice(1);
    // START (0,0,0) 与 END (3,0,0) 都在玩家 (2,2,2) 的 3×3×3 之外
    expect(isInFocus(START, PLAYER, 1)).toBe(false);
    expect(visualOf(START, { player: PLAYER, slice }).visible).toBe(true);
    expect(visualOf(END, { player: PLAYER, slice }).visible).toBe(true);
  });

  it('半径为 0 时不做任何过滤', () => {
    const slice = focusSlice(0);
    expect(visualOf({ x: 0, y: 3, z: 3 }, { player: PLAYER, slice }).visible).toBe(true);
  });

  it('与「只显示已探索区域」是同时满足的关系', () => {
    const slice: SliceState = { axis: 'none', level: 0, onlyExplored: true, focusRadius: 1 };
    // 在聚焦范围内，但未探索 -> 仍然隐藏
    expect(visualOf({ x: 3, y: 2, z: 2 }, { player: PLAYER, slice }).visible).toBe(false);
  });
});

describe('格子视觉状态', () => {
  it('起点已探索，因此同时显示数字和 S 角标', () => {
    const visual = visualOf(START);
    expect(visual.kind).toBe('start');
    expect(visual.label).toBe(`${cellAt(START).adjacentMineCount}@S`);
  });

  it('终点未探索时只显示 E，不泄露它的邻域雷数', () => {
    const visual = visualOf(END);
    expect(visual.kind).toBe('end');
    expect(visual.label).toBe('E');
  });

  it('终点被探索后显示数字和 E 角标', () => {
    const explored = { ...cellAt(END), explored: true };
    const visual = getCellVisual(explored, {
      player: START,
      start: START,
      end: END,
      slice: fullSlice,
      revealAllMines: false,
    });
    expect(visual.label).toBe(`${explored.adjacentMineCount}@E`);
  });

  it('玩家站在起点上时显示数字加 S 角标', () => {
    const visual = visualOf(START, { player: START });
    expect(visual.kind).toBe('player');
    expect(visual.label).toBe(`${cellAt(START).adjacentMineCount}@S`);
  });

  it('普通已探索格只显示数字', () => {
    const target: Position = { x: 2, y: 0, z: 0 };
    const explored = { ...cellAt(target), explored: true };
    const visual = getCellVisual(explored, {
      player: START,
      start: START,
      end: END,
      slice: fullSlice,
      revealAllMines: false,
    });
    expect(visual.kind).toBe('explored');
    expect(visual.label).toBe(String(explored.adjacentMineCount));
  });

  it('未探索格没有标签，插旗和已揭示地雷用图标', () => {
    const target: Position = { x: 2, y: 2, z: 0 };
    expect(visualOf(target).label).toBe('');

    const flagged = { ...cellAt(target), mark: 'flag' as const };
    expect(
      getCellVisual(flagged, {
        player: START,
        start: START,
        end: END,
        slice: fullSlice,
        revealAllMines: false,
      }).label,
    ).toBe('flag');

    const revealed = { ...cellAt(MINE), revealedMine: true };
    expect(
      getCellVisual(revealed, {
        player: START,
        start: START,
        end: END,
        slice: fullSlice,
        revealAllMines: false,
      }).label,
    ).toBe('mine');
  });

  it('切片过滤：层外格子标记为不在切片内，但仍然渲染', () => {
    const slice: SliceState = { axis: 'z', level: 0, onlyExplored: false, focusRadius: 0 };
    expect(visualOf({ x: 1, y: 1, z: 0 }, { slice }).inSlice).toBe(true);
    const outside = visualOf({ x: 1, y: 1, z: 2 }, { slice });
    expect(outside.inSlice).toBe(false);
    expect(outside.visible).toBe(true);
  });

  it('只显示已探索区域时，未知格不可见而起点终点仍可见', () => {
    const slice: SliceState = { axis: 'none', level: 0, onlyExplored: true, focusRadius: 0 };
    expect(visualOf({ x: 2, y: 2, z: 0 }, { slice }).visible).toBe(false);
    expect(visualOf(START, { slice }).visible).toBe(true);
    expect(visualOf(END, { slice }).visible).toBe(true);
  });
});
