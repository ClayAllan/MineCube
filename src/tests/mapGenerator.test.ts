import { describe, expect, it } from 'vitest';
import {
  MAX_DIM,
  MIN_DIM,
  computeMineCount,
  minStartEndDistance,
  totalCells,
} from '../game/constants';
import { generateMap, normalizeConfig, validateConfig } from '../game/mapGenerator';
import {
  countAdjacentMines,
  countOrthogonalMines,
  manhattan,
  positionToIndex,
  samePosition,
  sixNeighbors,
} from '../game/neighbors';
import { hasSafePath } from '../game/pathfinding';
import type { Dims, GameMap, Position } from '../game/types';

const cube = (n: number): Dims => ({ x: n, y: n, z: n });

function mineSet(map: GameMap): Set<number> {
  const mines = new Set<number>();
  map.cells.forEach((cell, index) => {
    if (cell.type === 'mine') mines.add(index);
  });
  return mines;
}

function rockSet(map: GameMap): Set<number> {
  const rocks = new Set<number>();
  map.cells.forEach((cell, index) => {
    if (cell.type === 'rock') rocks.add(index);
  });
  return rocks;
}

/** 地雷 + 岩块 = 全部不可通行格 */
function blockedSet(map: GameMap): Set<number> {
  const blocked = mineSet(map);
  for (const index of rockSet(map)) blocked.add(index);
  return blocked;
}

const SEEDS = ['minecube', '1', '42', 'seed-测试', '999999', 'abcdef'];

const SHAPES: Dims[] = [
  cube(4),
  cube(5),
  cube(6),
  cube(8),
  { x: 3, y: 3, z: 3 },
  { x: 10, y: 3, z: 5 },
  { x: 4, y: 9, z: 6 },
  { x: 9, y: 4, z: 9 },
];

describe('地图生成的基本约束', () => {
  for (const dims of SHAPES) {
    it(`${dims.x}×${dims.y}×${dims.z} 的地图满足全部硬性约束`, () => {
      for (const seed of SEEDS) {
        const map = generateMap({ dims, mineDensity: 0.15, seed });

        expect(map.dims).toEqual(dims);
        expect(map.cells).toHaveLength(totalCells(dims));

        // 起点和终点不同、都不是地雷也不是岩块
        expect(samePosition(map.start, map.end)).toBe(false);
        expect(map.cells[positionToIndex(dims, map.start)]!.type).toBe('start');
        expect(map.cells[positionToIndex(dims, map.end)]!.type).toBe('end');

        // 起终点距离约束
        expect(manhattan(map.start, map.end)).toBeGreaterThanOrEqual(minStartEndDistance(dims));

        // 起点 / 终点各自至少有两个可通行的六方向邻格（不会被完全包围）
        const blocked = blockedSet(map);
        const freeAround = (p: Position) =>
          sixNeighbors(dims, p).filter((n) => !blocked.has(positionToIndex(dims, n))).length;
        expect(freeAround(map.start)).toBeGreaterThanOrEqual(2);
        expect(freeAround(map.end)).toBeGreaterThanOrEqual(2);

        // 一定存在安全路径
        expect(hasSafePath(dims, blocked, map.start, map.end)).toBe(true);
        expect(map.shortestPathLength).toBeGreaterThan(0);
      }
    });
  }

  it('地雷数量合理：不超过目标值，且不会占满地图', () => {
    for (const seed of SEEDS) {
      const dims = cube(6);
      const density = 0.12;
      const map = generateMap({ dims, mineDensity: density, seed });
      expect(map.mineCount).toBeLessThanOrEqual(computeMineCount(dims, density));
      expect(map.mineCount).toBeGreaterThan(0);
      expect(map.mineCount).toBeLessThan(totalCells(dims));
    }
  });

  it('地雷数字在生成时预计算且与地雷布局一致', () => {
    const dims = cube(5);
    const map = generateMap({ dims, mineDensity: 0.15, seed: 'numbers' });
    const mines = mineSet(map);
    for (const cell of map.cells) {
      expect(cell.adjacentMineCount).toBe(countAdjacentMines(dims, cell.position, mines));
      expect(cell.adjacentMineCount).toBeGreaterThanOrEqual(0);
      expect(cell.adjacentMineCount).toBeLessThanOrEqual(26);
    }
  });

  it('六邻域雷数在生成时预计算且与地雷布局一致', () => {
    const dims = cube(5);
    const map = generateMap({ dims, mineDensity: 0.15, seed: 'orth' });
    const mines = mineSet(map);
    for (const cell of map.cells) {
      expect(cell.orthogonalMineCount).toBe(countOrthogonalMines(dims, cell.position, mines));
      expect(cell.orthogonalMineCount).toBeGreaterThanOrEqual(0);
      expect(cell.orthogonalMineCount).toBeLessThanOrEqual(6);
      // 六邻域是 26 邻域的子集，数量不可能更多
      expect(cell.orthogonalMineCount).toBeLessThanOrEqual(cell.adjacentMineCount);
    }
  });

  it('初始状态下只有起点是已探索的，没有旗帜和已揭示地雷', () => {
    const map = generateMap({ dims: cube(5), mineDensity: 0.12, seed: 'fog' });
    const explored = map.cells.filter((c) => c.explored);
    expect(explored).toHaveLength(1);
    expect(explored[0]!.position).toEqual(map.start);
    expect(map.cells.some((c) => c.mark === 'flag')).toBe(false);
    expect(map.cells.some((c) => c.revealedMine)).toBe(false);
  });
});

describe('岩块地形', () => {
  it('默认不生成岩块', () => {
    const map = generateMap({ dims: cube(6), mineDensity: 0.12, seed: 'no-rocks' });
    expect(map.rockCount).toBe(0);
    expect(map.cells.some((c) => c.type === 'rock')).toBe(false);
  });

  it('开启岩块后会生成岩块，且地图依然可通关', () => {
    for (const seed of SEEDS) {
      const dims: Dims = { x: 9, y: 4, z: 9 };
      const map = generateMap({ dims, mineDensity: 0.1, rockDensity: 0.1, seed });
      expect(map.rockCount).toBeGreaterThan(0);
      expect(hasSafePath(dims, blockedSet(map), map.start, map.end)).toBe(true);
    }
  });

  it('岩块不是地雷，不会被计入任何格子的邻域雷数', () => {
    const dims = cube(6);
    const map = generateMap({ dims, mineDensity: 0.1, rockDensity: 0.12, seed: 'rock-count' });
    const mines = mineSet(map);
    const rocks = rockSet(map);
    expect(rocks.size).toBeGreaterThan(0);
    for (const index of rocks) expect(mines.has(index)).toBe(false);
    for (const cell of map.cells) {
      expect(cell.adjacentMineCount).toBe(countAdjacentMines(dims, cell.position, mines));
    }
  });

  it('起点和终点不会被岩块占据', () => {
    for (const seed of SEEDS) {
      const dims = cube(5);
      const map = generateMap({ dims, mineDensity: 0.1, rockDensity: 0.15, seed });
      expect(map.cells[positionToIndex(dims, map.start)]!.type).toBe('start');
      expect(map.cells[positionToIndex(dims, map.end)]!.type).toBe('end');
    }
  });

  it('岩块 + 地雷总数不会超过可放置格数', () => {
    const dims = cube(4);
    const map = generateMap({ dims, mineDensity: 0.2, rockDensity: 0.15, seed: 'dense' });
    expect(map.mineCount + map.rockCount).toBeLessThan(totalCells(dims));
  });
});

describe('随机种子的确定性', () => {
  it('相同种子 + 相同参数生成完全相同的地图', () => {
    const a = generateMap({ dims: cube(6), mineDensity: 0.12, seed: 'same-seed' });
    const b = generateMap({ dims: cube(6), mineDensity: 0.12, seed: 'same-seed' });
    expect(a.start).toEqual(b.start);
    expect(a.end).toEqual(b.end);
    expect(a.mineCount).toBe(b.mineCount);
    expect(a.shortestPathLength).toBe(b.shortestPathLength);
    expect(a.cells).toEqual(b.cells);
  });

  it('带岩块时同样保持确定性', () => {
    const options = { dims: { x: 7, y: 4, z: 6 }, mineDensity: 0.1, rockDensity: 0.1, seed: 'det' };
    expect(generateMap(options).cells).toEqual(generateMap(options).cells);
  });

  it('数字种子与等价的字符串种子生成相同地图', () => {
    const a = generateMap({ dims: cube(5), mineDensity: 0.1, seed: 2024 });
    const b = generateMap({ dims: cube(5), mineDensity: 0.1, seed: '2024' });
    expect(a.cells).toEqual(b.cells);
  });

  it('不同种子通常生成不同地图', () => {
    const a = generateMap({ dims: cube(6), mineDensity: 0.12, seed: 'seed-a' });
    const b = generateMap({ dims: cube(6), mineDensity: 0.12, seed: 'seed-b' });
    expect(a.cells).not.toEqual(b.cells);
  });

  it('形状不同的地图不会互相等价', () => {
    const a = generateMap({ dims: { x: 6, y: 4, z: 5 }, mineDensity: 0.12, seed: 'shape' });
    const b = generateMap({ dims: { x: 5, y: 4, z: 6 }, mineDensity: 0.12, seed: 'shape' });
    expect(a.dims).not.toEqual(b.dims);
  });
});

describe('极端参数与健壮性', () => {
  it('高密度小地图也能生成，且不会无限循环', () => {
    const started = Date.now();
    for (const seed of SEEDS) {
      const dims = cube(4);
      const map = generateMap({ dims, mineDensity: 0.2, rockDensity: 0.15, seed });
      expect(hasSafePath(dims, blockedSet(map), map.start, map.end)).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it('极扁的地图也能生成并保持可通关', () => {
    for (const seed of SEEDS) {
      const dims: Dims = { x: 10, y: 3, z: 3 };
      const map = generateMap({ dims, mineDensity: 0.2, seed });
      expect(hasSafePath(dims, blockedSet(map), map.start, map.end)).toBe(true);
    }
  });

  it('非法参数会被自动收敛到合法范围而不是崩溃', () => {
    const tooSmall = generateMap({ dims: { x: 1, y: 0, z: -3 }, mineDensity: -5, seed: '' });
    expect(tooSmall.dims).toEqual(cube(MIN_DIM));
    expect(tooSmall.mineCount).toBeGreaterThanOrEqual(0);

    const tooBig = generateMap({ dims: { x: 99, y: 99, z: 99 }, mineDensity: 5, seed: 'x' });
    expect(tooBig.dims).toEqual(cube(MAX_DIM));
    expect(hasSafePath(tooBig.dims, blockedSet(tooBig), tooBig.start, tooBig.end)).toBe(true);
  });

  it('maxAttempts 为 1 时会走后备方案并依然保证可通关', () => {
    for (const seed of SEEDS) {
      const dims = cube(4);
      const map = generateMap({ dims, mineDensity: 0.2, rockDensity: 0.15, seed, maxAttempts: 1 });
      expect(hasSafePath(dims, blockedSet(map), map.start, map.end)).toBe(true);
    }
  });
});

describe('配置规范化与校验', () => {
  it('normalizeConfig 会裁剪越界值', () => {
    const config = normalizeConfig({
      dims: { x: 100, y: 100, z: 100 },
      mineDensity: 0.99,
      rockDensity: 0.99,
      lives: 50,
      seed: '  ',
    });
    expect(config.dims).toEqual(cube(MAX_DIM));
    expect(config.mineDensity).toBe(0.2);
    expect(config.rockDensity).toBe(0.15);
    expect(config.lives).toBe(9);
    expect(config.seed).toBe('1');
  });

  it('normalizeConfig 保留合法的非立方体尺寸', () => {
    expect(normalizeConfig({ dims: { x: 4, y: 7, z: 10 } }).dims).toEqual({ x: 4, y: 7, z: 10 });
  });

  it('validateConfig 能报出各类非法输入', () => {
    const issues = validateConfig({
      dims: { x: 2, y: 5, z: 5 },
      mineDensity: 0.9,
      rockDensity: 0.9,
      lives: 0,
      seed: '',
    });
    expect(issues.map((i) => i.field).sort()).toEqual([
      'dims',
      'lives',
      'mineDensity',
      'rockDensity',
      'seed',
    ]);
    expect(
      validateConfig({
        dims: cube(6),
        mineDensity: 0.12,
        rockDensity: 0,
        lives: 3,
        seed: 'ok',
      }),
    ).toHaveLength(0);
  });
});
