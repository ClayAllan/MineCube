import {
  DEFAULT_DIFFICULTY,
  MAX_DENSITY,
  MAX_DIM,
  MAX_GENERATION_ATTEMPTS,
  MAX_LIVES,
  MAX_ROCK_DENSITY,
  MIN_DENSITY,
  MIN_DIM,
  MIN_LIVES,
  MAX_PRESCOUT_RADIUS,
  MIN_ROCK_DENSITY,
  computeMineCount,
  computeRockCount,
  minStartEndDistance,
  totalCells,
} from './constants';
import {
  countAdjacentMines,
  countOrthogonalMines,
  indexToPosition,
  manhattan,
  positionToIndex,
  samePosition,
  sixNeighbors,
} from './neighbors';
import { findShortestPath, hasSafePath } from './pathfinding';
import { createRng, hashSeed, type Rng } from './seededRandom';
import type { Cell, DifficultyOptions, Dims, GameMap, MapConfig, Position } from './types';

export interface GenerateMapOptions {
  dims: Dims;
  mineDensity: number;
  /** 岩块密度，缺省为 0（不生成岩块） */
  rockDensity?: number;
  seed: string | number;
  /** 布局最大随机尝试次数，超过后使用后备方案 */
  maxAttempts?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampDim(value: unknown): number {
  return Math.round(clamp(Number(value), MIN_DIM, MAX_DIM));
}

export function normalizeDims(dims: Partial<Dims> | undefined): Dims {
  return {
    x: clampDim(dims?.x),
    y: clampDim(dims?.y),
    z: clampDim(dims?.z),
  };
}

function normalizeDifficulty(options: Partial<DifficultyOptions> | undefined): DifficultyOptions {
  return {
    showEndPosition: options?.showEndPosition ?? DEFAULT_DIFFICULTY.showEndPosition,
    showEndNumber: options?.showEndNumber ?? DEFAULT_DIFFICULTY.showEndNumber,
    showOrthogonalCount: options?.showOrthogonalCount ?? DEFAULT_DIFFICULTY.showOrthogonalCount,
    prescoutRadius: Math.round(clamp(Number(options?.prescoutRadius ?? 0), 0, MAX_PRESCOUT_RADIUS)),
    allowAnalysis: options?.allowAnalysis ?? DEFAULT_DIFFICULTY.allowAnalysis,
  };
}

/** 把用户输入规范到合法范围，避免非法参数导致崩溃 */
export function normalizeConfig(config: Partial<MapConfig>): MapConfig {
  const mineDensity = clamp(Number(config.mineDensity ?? 0.12), MIN_DENSITY, MAX_DENSITY);
  const rockDensity = clamp(Number(config.rockDensity ?? 0), MIN_ROCK_DENSITY, MAX_ROCK_DENSITY);
  const lives = Math.round(clamp(Number(config.lives ?? 3), MIN_LIVES, MAX_LIVES));
  const rawSeed = typeof config.seed === 'string' ? config.seed.trim() : String(config.seed ?? '');
  return {
    dims: normalizeDims(config.dims),
    mineDensity,
    rockDensity,
    lives,
    seed: rawSeed === '' ? '1' : rawSeed,
    difficulty: normalizeDifficulty(config.difficulty),
    presetId: config.presetId ?? 'custom',
  };
}

export interface ConfigIssue {
  field: 'dims' | 'mineDensity' | 'rockDensity' | 'lives' | 'seed';
  message: string;
}

/** 校验输入，用于开始界面提示（不抛异常） */
export function validateConfig(config: Partial<MapConfig>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const dims = config.dims;
  const badAxis = (['x', 'y', 'z'] as const).some((axis) => {
    const value = Number(dims?.[axis]);
    return !Number.isFinite(value) || value < MIN_DIM || value > MAX_DIM;
  });
  if (!dims || badAxis) {
    issues.push({ field: 'dims', message: `地图每个方向的尺寸必须在 ${MIN_DIM} 到 ${MAX_DIM} 之间` });
  }
  const density = Number(config.mineDensity);
  if (!Number.isFinite(density) || density < MIN_DENSITY || density > MAX_DENSITY) {
    issues.push({
      field: 'mineDensity',
      message: `地雷密度必须在 ${Math.round(MIN_DENSITY * 100)}% 到 ${Math.round(MAX_DENSITY * 100)}% 之间`,
    });
  }
  const rock = Number(config.rockDensity ?? 0);
  if (!Number.isFinite(rock) || rock < MIN_ROCK_DENSITY || rock > MAX_ROCK_DENSITY) {
    issues.push({
      field: 'rockDensity',
      message: `岩块密度必须在 0% 到 ${Math.round(MAX_ROCK_DENSITY * 100)}% 之间`,
    });
  }
  const lives = Number(config.lives);
  if (!Number.isFinite(lives) || lives < MIN_LIVES || lives > MAX_LIVES) {
    issues.push({ field: 'lives', message: `初始生命必须在 ${MIN_LIVES} 到 ${MAX_LIVES} 之间` });
  }
  if (typeof config.seed === 'string' && config.seed.trim() === '') {
    issues.push({ field: 'seed', message: '随机种子不能为空' });
  }
  return issues;
}

/**
 * 挑选起点与终点：
 * - 两者不同；
 * - 曼哈顿距离不小于 minStartEndDistance(dims)；
 * - 各自至少有 2 个六方向邻格（保证有安全出入口的空间）。
 */
function pickStartAndEnd(dims: Dims, rng: Rng): { start: Position; end: Position } {
  const total = totalCells(dims);
  const required = minStartEndDistance(dims);

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const start = indexToPosition(dims, rng.int(total));
    const end = indexToPosition(dims, rng.int(total));
    if (samePosition(start, end)) continue;
    if (manhattan(start, end) < required) continue;
    if (sixNeighbors(dims, start).length < 2) continue;
    if (sixNeighbors(dims, end).length < 2) continue;
    return { start, end };
  }

  // 极端兜底：尝试多个对角角落组合
  const corners: [Position, Position][] = [
    [{ x: 0, y: 0, z: 0 }, { x: dims.x - 1, y: dims.y - 1, z: dims.z - 1 }],
    [{ x: 0, y: 0, z: dims.z - 1 }, { x: dims.x - 1, y: dims.y - 1, z: 0 }],
    [{ x: 0, y: dims.y - 1, z: 0 }, { x: dims.x - 1, y: 0, z: dims.z - 1 }],
    [{ x: dims.x - 1, y: 0, z: 0 }, { x: 0, y: dims.y - 1, z: dims.z - 1 }],
  ];

  for (const [start, end] of corners) {
    if (
      manhattan(start, end) >= required &&
      sixNeighbors(dims, start).length >= 2 &&
      sixNeighbors(dims, end).length >= 2
    ) {
      return { start, end };
    }
  }

  // 最后的兜底：即使不满足距离要求也返回对角（保证地图生成不会崩溃）
  // 此时 generateMap 中的 BFS 校验仍会生效，确保至少存在安全路径
  return {
    start: { x: 0, y: 0, z: 0 },
    end: { x: dims.x - 1, y: dims.y - 1, z: dims.z - 1 },
  };
}

/**
 * 为起点 / 终点保留安全出入口。
 * 起点周围至少保留两个安全出口，终点周围至少保留两个安全入口。
 */
function reserveExits(
  dims: Dims,
  origin: Position,
  rng: Rng,
  protectedSet: Set<number>,
  count = 2,
): void {
  const candidates = sixNeighbors(dims, origin).filter(
    (p) => !protectedSet.has(positionToIndex(dims, p)),
  );
  rng.shuffle(candidates);
  for (let i = 0; i < Math.min(count, candidates.length); i += 1) {
    protectedSet.add(positionToIndex(dims, candidates[i]!));
  }
}

/**
 * 生成成簇的岩块。
 * 随机撒点然后沿六方向生长若干格，比纯随机散点更像天然地形，
 * 也更容易形成有意义的绕行。生长次数有上限，不会死循环。
 */
export function placeRocks(
  dims: Dims,
  rng: Rng,
  count: number,
  forbidden: ReadonlySet<number>,
): Set<number> {
  const rocks = new Set<number>();
  if (count <= 0) return rocks;
  const total = totalCells(dims);
  let guard = count * 20 + 50;

  while (rocks.size < count && guard > 0) {
    guard -= 1;
    const seedIndex = rng.int(total);
    if (forbidden.has(seedIndex) || rocks.has(seedIndex)) continue;
    rocks.add(seedIndex);

    let current = indexToPosition(dims, seedIndex);
    const clusterSize = Math.min(count - rocks.size, rng.range(1, 4));
    for (let i = 0; i < clusterSize; i += 1) {
      const options = sixNeighbors(dims, current).filter((p) => {
        const index = positionToIndex(dims, p);
        return !forbidden.has(index) && !rocks.has(index);
      });
      if (options.length === 0) break;
      const next = rng.pick(options);
      rocks.add(positionToIndex(dims, next));
      current = next;
    }
  }
  return rocks;
}

/**
 * 后备方案：随机化地生成一条从起点通往终点的安全路径。
 * 策略：优先选择能缩短与终点曼哈顿距离的方向，并以一定概率随机绕行，
 * 因此路径不会总是笔直的；走进死角时回溯。
 */
export function generateSafePath(dims: Dims, start: Position, end: Position, rng: Rng): Position[] {
  const path: Position[] = [{ ...start }];
  const visited = new Set<number>([positionToIndex(dims, start)]);
  let guard = totalCells(dims) * 8;

  while (!samePosition(path[path.length - 1]!, end) && guard > 0) {
    guard -= 1;
    const current = path[path.length - 1]!;
    const options = sixNeighbors(dims, current).filter(
      (p) => !visited.has(positionToIndex(dims, p)),
    );

    if (options.length === 0) {
      // 死角：回溯一步（已访问集合保留，避免再次走进同一死角）
      path.pop();
      if (path.length === 0) break;
      continue;
    }

    const currentDistance = manhattan(current, end);
    const improving = options.filter((p) => manhattan(p, end) < currentDistance);
    // 25% 概率放弃最优方向，制造曲折
    const next =
      improving.length > 0 && rng.next() > 0.25 ? rng.pick(improving) : rng.pick(options);

    visited.add(positionToIndex(dims, next));
    path.push(next);
  }

  if (path.length > 0 && samePosition(path[path.length - 1]!, end)) {
    return path;
  }
  return straightPath(start, end);
}

/** 轴对齐的兜底路径：先走 x，再走 y，最后走 z。一定存在且合法。 */
function straightPath(start: Position, end: Position): Position[] {
  const path: Position[] = [{ ...start }];
  const cursor: Position = { ...start };
  const step = (axis: 'x' | 'y' | 'z') => {
    while (cursor[axis] !== end[axis]) {
      cursor[axis] += cursor[axis] < end[axis] ? 1 : -1;
      path.push({ ...cursor });
    }
  };
  step('x');
  step('y');
  step('z');
  return path;
}

export function buildCells(
  dims: Dims,
  mines: ReadonlySet<number>,
  rocks: ReadonlySet<number>,
  start: Position,
  end: Position,
): Cell[] {
  const total = totalCells(dims);
  const cells: Cell[] = new Array(total);
  const startIndex = positionToIndex(dims, start);
  const endIndex = positionToIndex(dims, end);

  for (let index = 0; index < total; index += 1) {
    const position = indexToPosition(dims, index);
    const type = mines.has(index)
      ? 'mine'
      : rocks.has(index)
        ? 'rock'
        : index === startIndex
          ? 'start'
          : index === endIndex
            ? 'end'
            : 'safe';
    cells[index] = {
      position,
      // 地雷数字在生成时一次性预计算，游戏过程中不再重算；岩块不计入雷数
      adjacentMineCount: countAdjacentMines(dims, position, mines),
      orthogonalMineCount: countOrthogonalMines(dims, position, mines),
      type,
      explored: index === startIndex,
      mark: 'none',
      revealedMine: false,
    };
  }
  return cells;
}

/**
 * 生成一张保证存在安全路径的三维扫雷地图。
 *
 * 流程：
 * 1. 由种子创建确定性 PRNG；
 * 2. 选取满足距离约束的起点 / 终点，并保留安全出入口；
 * 3. 先撒成簇的岩块，再在剩余候选格中放雷，用 BFS 检查连通性（岩块与地雷都算障碍），
 *    最多重试 maxAttempts 次；
 * 4. 仍失败则使用后备方案：先铺一条随机安全路径并锁定，再放岩块和雷，最后再次 BFS 校验。
 *
 * 整个流程有明确的次数上限，不会进入无限循环。
 */
export function generateMap(options: GenerateMapOptions): GameMap {
  const dims = normalizeDims(options.dims);
  const density = clamp(Number(options.mineDensity), MIN_DENSITY, MAX_DENSITY);
  const rockDensity = clamp(Number(options.rockDensity ?? 0), MIN_ROCK_DENSITY, MAX_ROCK_DENSITY);
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_GENERATION_ATTEMPTS);
  const seedValue = hashSeed(options.seed);
  const rng = createRng(seedValue);
  const total = totalCells(dims);

  const { start, end } = pickStartAndEnd(dims, rng);
  const startIndex = positionToIndex(dims, start);
  const endIndex = positionToIndex(dims, end);

  // 受保护格：起点、终点及其安全出入口，永远不放雷也不放岩块
  const protectedSet = new Set<number>([startIndex, endIndex]);
  reserveExits(dims, start, rng, protectedSet, 2);
  reserveExits(dims, end, rng, protectedSet, 2);

  const freeCount = total - protectedSet.size;
  // 可放置位置不足时自动降低数量，而不是崩溃
  const desiredRocks = Math.min(computeRockCount(dims, rockDensity), Math.max(0, freeCount - 1));
  const desiredMines = Math.min(
    computeMineCount(dims, density),
    Math.max(0, freeCount - desiredRocks),
  );

  let mines: Set<number> | null = null;
  let rocks: Set<number> = new Set();
  let attempts = 0;
  let usedFallback = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const trialRocks = placeRocks(dims, rng, desiredRocks, protectedSet);

    const minePool: number[] = [];
    for (let index = 0; index < total; index += 1) {
      if (!protectedSet.has(index) && !trialRocks.has(index)) minePool.push(index);
    }
    rng.shuffle(minePool);
    const trialMines = new Set<number>(minePool.slice(0, Math.min(desiredMines, minePool.length)));

    const blocked = new Set<number>(trialRocks);
    for (const index of trialMines) blocked.add(index);

    if (hasSafePath(dims, blocked, start, end)) {
      mines = trialMines;
      rocks = trialRocks;
      break;
    }
  }

  if (!mines) {
    // 后备方案：锁定一条安全路径 + 起终点缓冲区，再放岩块和雷
    usedFallback = true;
    const path = generateSafePath(dims, start, end, rng);
    const locked = new Set<number>(protectedSet);
    for (const p of path) locked.add(positionToIndex(dims, p));
    for (const p of sixNeighbors(dims, start)) locked.add(positionToIndex(dims, p));
    for (const p of sixNeighbors(dims, end)) locked.add(positionToIndex(dims, p));

    rocks = placeRocks(dims, rng, desiredRocks, locked);

    const fallbackPool: number[] = [];
    for (let index = 0; index < total; index += 1) {
      if (!locked.has(index) && !rocks.has(index)) fallbackPool.push(index);
    }
    rng.shuffle(fallbackPool);
    const fallbackMines = new Set<number>(
      fallbackPool.slice(0, Math.min(desiredMines, fallbackPool.length)),
    );

    // 路径整条被锁定，理论上必然连通；仍然做一次 BFS 校验作为兜底
    const blocked = new Set<number>(rocks);
    for (const index of fallbackMines) blocked.add(index);
    if (!hasSafePath(dims, blocked, start, end)) {
      for (const p of path) {
        const index = positionToIndex(dims, p);
        fallbackMines.delete(index);
        rocks.delete(index);
      }
    }
    mines = fallbackMines;
  }

  return createMapFromMines(dims, mines, start, end, { rocks, seedValue, attempts, usedFallback });
}

/**
 * 由确定的地雷 / 岩块集合直接构造 GameMap（预计算地雷数字与最短安全路径）。
 * 供 generateMap 内部使用，也方便测试构造固定地图。
 */
export function createMapFromMines(
  dims: Dims,
  mines: ReadonlySet<number>,
  start: Position,
  end: Position,
  meta: {
    rocks?: ReadonlySet<number>;
    seedValue?: number;
    attempts?: number;
    usedFallback?: boolean;
  } = {},
): GameMap {
  const rocks = meta.rocks ?? new Set<number>();
  const cells = buildCells(dims, mines, rocks, start, end);

  const blocked = new Set<number>(rocks);
  for (const index of mines) blocked.add(index);
  const path = findShortestPath(dims, blocked, start, end);

  return {
    dims,
    cells,
    start,
    end,
    mineCount: mines.size,
    rockCount: rocks.size,
    shortestPathLength: path ? path.length - 1 : -1,
    seedValue: meta.seedValue ?? 0,
    attempts: meta.attempts ?? 1,
    usedFallback: meta.usedFallback ?? false,
  };
}
