import { describe, expect, it } from 'vitest';
import { manhattan, positionToIndex } from '../game/neighbors';
import { findShortestPath, hasSafePath, shortestPathLength } from '../game/pathfinding';
import type { Dims, Position } from '../game/types';

const SIZE: Dims = { x: 4, y: 4, z: 4 };
const idx = (p: Position) => positionToIndex(SIZE, p);

describe('BFS 最短安全路径', () => {
  it('空地图上最短路径长度等于曼哈顿距离', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 3, y: 3, z: 3 };
    expect(shortestPathLength(SIZE, new Set(), start, end)).toBe(manhattan(start, end));
  });

  it('返回的路径每一步都是六方向相邻，且首尾正确', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 3, y: 2, z: 1 };
    const path = findShortestPath(SIZE, new Set(), start, end);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual(start);
    expect(path![path!.length - 1]).toEqual(end);
    for (let i = 1; i < path!.length; i += 1) {
      expect(manhattan(path![i - 1]!, path![i]!)).toBe(1);
    }
  });

  it('路径会绕开地雷', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 2, y: 0, z: 0 };
    const mines = new Set([idx({ x: 1, y: 0, z: 0 })]);
    const path = findShortestPath(SIZE, mines, start, end);
    expect(path).not.toBeNull();
    for (const p of path!) expect(mines.has(idx(p))).toBe(false);
    expect(path!.length - 1).toBeGreaterThan(manhattan(start, end));
  });

  it('起点被地雷完全包围时不存在路径', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 3, y: 3, z: 3 };
    const mines = new Set([
      idx({ x: 1, y: 0, z: 0 }),
      idx({ x: 0, y: 1, z: 0 }),
      idx({ x: 0, y: 0, z: 1 }),
    ]);
    expect(hasSafePath(SIZE, mines, start, end)).toBe(false);
    expect(shortestPathLength(SIZE, mines, start, end)).toBe(-1);
  });

  it('起点与终点相同时路径长度为 0', () => {
    const p = { x: 1, y: 1, z: 1 };
    expect(shortestPathLength(SIZE, new Set(), p, p)).toBe(0);
  });

  it('起点或终点本身是地雷时视为不可达', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 3, y: 3, z: 3 };
    expect(hasSafePath(SIZE, new Set([idx(start)]), start, end)).toBe(false);
    expect(hasSafePath(SIZE, new Set([idx(end)]), start, end)).toBe(false);
  });
});
