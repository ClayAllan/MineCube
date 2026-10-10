import { DIRECTIONS } from './constants';
import type { Dims, Position } from './types';

/** 扁平索引：index = x + y * dims.x + z * dims.x * dims.y */
export function toIndex(dims: Dims, x: number, y: number, z: number): number {
  return x + y * dims.x + z * dims.x * dims.y;
}

export function positionToIndex(dims: Dims, p: Position): number {
  return toIndex(dims, p.x, p.y, p.z);
}

export function indexToPosition(dims: Dims, index: number): Position {
  const layer = dims.x * dims.y;
  return {
    x: index % dims.x,
    y: Math.floor(index / dims.x) % dims.y,
    z: Math.floor(index / layer),
  };
}

export function inBounds(dims: Dims, p: Position): boolean {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    Number.isInteger(p.z) &&
    p.x >= 0 &&
    p.x < dims.x &&
    p.y >= 0 &&
    p.y < dims.y &&
    p.z >= 0 &&
    p.z < dims.z
  );
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function positionKey(p: Position): string {
  return `${p.x},${p.y},${p.z}`;
}

export function addDelta(p: Position, d: Position): Position {
  return { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
}

export function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

/**
 * 六方向移动邻居（正交，不含斜向），自动裁剪掉地图外坐标。
 * 内部格 6 个，面上 5 个，棱上 4 个，角上 3 个。
 */
export function sixNeighbors(dims: Dims, p: Position): Position[] {
  const result: Position[] = [];
  for (const dir of DIRECTIONS) {
    const n = addDelta(p, dir.delta);
    if (inBounds(dims, n)) result.push(n);
  }
  return result;
}

/**
 * 26 邻域探测邻居：|dx|<=1 且 |dy|<=1 且 |dz|<=1，排除自身，裁剪地图外坐标。
 * 内部格 26 个，面上 17 个，棱上 11 个，角上 7 个。
 */
export function twentySixNeighbors(dims: Dims, p: Position): Position[] {
  const result: Position[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (inBounds(dims, n)) result.push(n);
      }
    }
  }
  return result;
}

/**
 * 统计某格 26 邻域内的地雷数量。
 * mines 为地雷格的扁平索引集合，不统计当前格自身；岩块不是地雷，不会被计入。
 */
export function countAdjacentMines(dims: Dims, p: Position, mines: ReadonlySet<number>): number {
  let count = 0;
  for (const n of twentySixNeighbors(dims, p)) {
    if (mines.has(positionToIndex(dims, n))) count += 1;
  }
  return count;
}

/**
 * 统计某格六个正交邻格中的地雷数量（0~6）。
 * 这是 26 邻域数字之外的一个更细的可选线索，恰好对应玩家能走的六个方向。
 */
export function countOrthogonalMines(
  dims: Dims,
  p: Position,
  mines: ReadonlySet<number>,
): number {
  let count = 0;
  for (const n of sixNeighbors(dims, p)) {
    if (mines.has(positionToIndex(dims, n))) count += 1;
  }
  return count;
}
