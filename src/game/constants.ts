import type { DifficultyOptions, Dims, Direction, MapConfig } from './types';

/** 单个方向的尺寸限制（地图不要求是立方体） */
export const MIN_DIM = 3;
export const MAX_DIM = 10;

/** 超过这个格数会给出性能提示 */
export const PERF_WARN_CELLS = 640;

/** 地雷密度限制 */
export const MIN_DENSITY = 0.05;
export const MAX_DENSITY = 0.2;

/** 岩块密度限制（0 表示不生成岩块） */
export const MIN_ROCK_DENSITY = 0;
export const MAX_ROCK_DENSITY = 0.15;

/** 生命限制 */
export const MIN_LIVES = 1;
export const MAX_LIVES = 9;

/**
 * 地图生成时的最大重试次数。
 * 值 100 是经验选择：足够覆盖绝大多数地图配置，同时保证在极端配置下也不会陷入长时间阻塞。
 * 超过此次数后，启动后备方案（锁定一条安全路径并在其周边安全放置地形）。
 */
export const MAX_GENERATION_ATTEMPTS = 100;

/**
 * 六个正交移动方向。
 * 坐标轴约定：X 左右、Y 上下、Z 前后（Z 减小为「前」，与默认相机朝向一致）。
 */
export const DIRECTIONS: readonly Direction[] = [
  { id: 'forward', key: 'W', label: '前', axisLabel: 'Z −', delta: { x: 0, y: 0, z: -1 } },
  { id: 'back', key: 'S', label: '后', axisLabel: 'Z +', delta: { x: 0, y: 0, z: 1 } },
  { id: 'left', key: 'A', label: '左', axisLabel: 'X −', delta: { x: -1, y: 0, z: 0 } },
  { id: 'right', key: 'D', label: '右', axisLabel: 'X +', delta: { x: 1, y: 0, z: 0 } },
  { id: 'up', key: 'E', label: '上', axisLabel: 'Y +', delta: { x: 0, y: 1, z: 0 } },
  { id: 'down', key: 'Q', label: '下', axisLabel: 'Y −', delta: { x: 0, y: -1, z: 0 } },
] as const;

export const DIRECTION_BY_KEY: Record<string, Direction> = DIRECTIONS.reduce<Record<string, Direction>>(
  (acc, dir) => {
    acc[dir.key] = dir;
    return acc;
  },
  {},
);

/**
 * 开局预探索半径的最大值（切比雪夫距离）。
 * 值 2 表示最多预探索 5×5×5 = 125 个格子。
 * 对应「开局预探索半径 2」难度修正项（约占 6×6×6 地图的 58.0%）。
 */
export const MAX_PRESCOUT_RADIUS = 2;

/**
 * 聚焦半径的最大值（切比雪夫距离）。
 * 值 3 表示最多显示 7×7×7 = 343 个格子，足以查看完整的周边信息。
 * 这是玩家在「切片查看」时可以选择的最大范围。
 */
export const MAX_FOCUS_RADIUS = 3;

export const DEFAULT_DIFFICULTY: DifficultyOptions = {
  showEndPosition: true,
  showEndNumber: false,
  showOrthogonalCount: false,
  prescoutRadius: 0,
  allowAnalysis: true,
};

export interface DifficultyPreset {
  id: string;
  name: string;
  description: string;
  dims: Dims;
  mineDensity: number;
  rockDensity: number;
  lives: number;
  difficulty: DifficultyOptions;
}

const cube = (n: number): Dims => ({ x: n, y: n, z: n });

export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  {
    id: 'tutorial',
    name: '教学模式',
    description: '空间小、雷少、生命多，适合熟悉三维移动。',
    dims: cube(4),
    mineDensity: 0.07,
    rockDensity: 0,
    lives: 5,
    difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 1, showEndNumber: true },
  },
  {
    id: 'easy',
    name: '简单模式',
    description: '较宽松的雷区，适合稳定通关。',
    dims: cube(5),
    mineDensity: 0.09,
    rockDensity: 0,
    lives: 4,
    difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 1 },
  },
  {
    id: 'normal',
    name: '普通模式',
    description: '标准体验，需要认真读数字。',
    dims: cube(6),
    mineDensity: 0.12,
    rockDensity: 0,
    lives: 3,
    difficulty: DEFAULT_DIFFICULTY,
  },
  {
    id: 'hard',
    name: '困难模式',
    description: '雷密生命少，几乎不允许失误。',
    dims: cube(7),
    mineDensity: 0.15,
    rockDensity: 0,
    lives: 2,
    difficulty: DEFAULT_DIFFICULTY,
  },
  {
    id: 'caverns',
    name: '洞窟模式',
    description: '扁长地图加上实心岩块，路线本身就是难题。',
    dims: { x: 9, y: 4, z: 9 },
    mineDensity: 0.1,
    rockDensity: 0.1,
    lives: 3,
    difficulty: DEFAULT_DIFFICULTY,
  },
] as const;

export const CUSTOM_PRESET_ID = 'custom';

export const DEFAULT_CONFIG: MapConfig = {
  dims: cube(6),
  mineDensity: 0.12,
  rockDensity: 0,
  lives: 3,
  seed: 'minecube',
  difficulty: DEFAULT_DIFFICULTY,
  presetId: 'normal',
};

export const STORAGE_KEY = 'minecube:last-config';

export function totalCells(dims: Dims): number {
  return dims.x * dims.y * dims.z;
}

export function isCube(dims: Dims): boolean {
  return dims.x === dims.y && dims.y === dims.z;
}

export function formatDims(dims: Dims): string {
  return `${dims.x} × ${dims.y} × ${dims.z}`;
}

/** 按格数与密度计算目标数量 */
export function computeMineCount(dims: Dims, density: number): number {
  return Math.round(totalCells(dims) * density);
}

export function computeRockCount(dims: Dims, density: number): number {
  return Math.round(totalCells(dims) * density);
}

/**
 * 起点与终点之间要求的最小曼哈顿距离。
 * 非立方体地图按三个方向的平均边长计算，并且不会超过地图能提供的最大距离。
 */
export function minStartEndDistance(dims: Dims): number {
  const average = (dims.x + dims.y + dims.z) / 3;
  const maxPossible = dims.x - 1 + (dims.y - 1) + (dims.z - 1);
  return Math.min(Math.floor(average * 1.5), maxPossible);
}

/**
 * 难度系数。
 * 以「普通模式」的默认配置（6×6×6、12% 雷、3 条命、显示终点、无预探索、允许分析）为 1.00 基准，
 * 每一项按乘法叠加，方便横向比较不同配置的难度。
 */
export function difficultyCoefficient(config: MapConfig): number {
  const densityFactor = config.mineDensity / 0.12;
  const sizeFactor = Math.sqrt(totalCells(config.dims) / 216);
  const livesFactor = 3 / Math.max(1, config.lives);
  const rockFactor = 1 + config.rockDensity * 1.5;

  const o = config.difficulty;
  let modifier = 1;
  // 藏起终点会大幅提高难度：玩家必须靠距离提示自己摸索方向
  if (!o.showEndPosition) modifier *= 1.35;
  if (o.showEndNumber) modifier *= 0.92;
  // 六邻域数字让内部区域第一次真正可推理，是最强的降难度修正项
  if (o.showOrthogonalCount) modifier *= 0.75;
  if (o.prescoutRadius >= 2) modifier *= 0.72;
  else if (o.prescoutRadius === 1) modifier *= 0.85;
  if (!o.allowAnalysis) modifier *= 1.12;

  const value = densityFactor * sizeFactor * livesFactor * rockFactor * modifier;
  return Math.round(value * 100) / 100;
}

export function difficultyLabel(coefficient: number): string {
  if (coefficient < 0.6) return '轻松';
  if (coefficient < 1.0) return '偏易';
  if (coefficient < 1.6) return '标准';
  if (coefficient < 2.6) return '偏难';
  return '硬核';
}
