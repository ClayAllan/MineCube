import { DIRECTIONS, totalCells } from './constants';
import { indexToPosition, positionToIndex } from './neighbors';
import type { Dims, Position } from './types';

/**
 * 六方向 BFS。地雷与岩块都视为不可通行格（统称 blocked）。
 * 使用扁平索引 + 类型化数组，1000 格以内开销可以忽略。
 */

/** 预计算某个尺寸下每个索引的六方向邻居索引表，避免 BFS 中反复做边界判断 */
function buildNeighborTable(dims: Dims): Int32Array[] {
  const total = totalCells(dims);
  const table: Int32Array[] = new Array(total);
  for (let index = 0; index < total; index += 1) {
    const p = indexToPosition(dims, index);
    const list: number[] = [];
    for (const dir of DIRECTIONS) {
      const nx = p.x + dir.delta.x;
      const ny = p.y + dir.delta.y;
      const nz = p.z + dir.delta.z;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= dims.x || ny >= dims.y || nz >= dims.z) continue;
      list.push(nx + ny * dims.x + nz * dims.x * dims.y);
    }
    table[index] = Int32Array.from(list);
  }
  return table;
}

const neighborTableCache = new Map<string, Int32Array[]>();

function getNeighborTable(dims: Dims): Int32Array[] {
  const key = `${dims.x}x${dims.y}x${dims.z}`;
  let table = neighborTableCache.get(key);
  if (!table) {
    table = buildNeighborTable(dims);
    neighborTableCache.set(key, table);
  }
  return table;
}

/**
 * BFS 求最短安全路径。
 * @param blocked 不可通行格的扁平索引集合（地雷 + 岩块）
 * @returns 从起点到终点的坐标数组（含首尾）；不存在路径时返回 null。
 */
export function findShortestPath(
  dims: Dims,
  blocked: ReadonlySet<number>,
  start: Position,
  end: Position,
): Position[] | null {
  const total = totalCells(dims);
  const startIndex = positionToIndex(dims, start);
  const endIndex = positionToIndex(dims, end);

  if (startIndex < 0 || startIndex >= total || endIndex < 0 || endIndex >= total) return null;
  if (blocked.has(startIndex) || blocked.has(endIndex)) return null;
  if (startIndex === endIndex) return [{ ...start }];

  const table = getNeighborTable(dims);
  const prev = new Int32Array(total).fill(-1);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  queue[tail] = startIndex;
  tail += 1;
  visited[startIndex] = 1;

  while (head < tail) {
    const current = queue[head]!;
    head += 1;
    if (current === endIndex) break;

    const neighbors = table[current]!;
    for (let i = 0; i < neighbors.length; i += 1) {
      const n = neighbors[i]!;
      if (visited[n] || blocked.has(n)) continue;
      visited[n] = 1;
      prev[n] = current;
      queue[tail] = n;
      tail += 1;
    }
  }

  if (!visited[endIndex]) return null;

  const path: Position[] = [];
  let cursor = endIndex;
  while (cursor !== -1) {
    path.push(indexToPosition(dims, cursor));
    if (cursor === startIndex) break;
    cursor = prev[cursor]!;
  }
  path.reverse();
  return path;
}

/** 起点与终点之间是否存在只经过可通行格的六方向路径 */
export function hasSafePath(
  dims: Dims,
  blocked: ReadonlySet<number>,
  start: Position,
  end: Position,
): boolean {
  return findShortestPath(dims, blocked, start, end) !== null;
}

/**
 * 最短安全路径的「步数」（路径格数 - 1）。
 * 不存在路径时返回 -1。
 */
export function shortestPathLength(
  dims: Dims,
  blocked: ReadonlySet<number>,
  start: Position,
  end: Position,
): number {
  const path = findShortestPath(dims, blocked, start, end);
  return path ? path.length - 1 : -1;
}
