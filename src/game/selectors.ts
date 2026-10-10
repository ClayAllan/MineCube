import { difficultyCoefficient, totalCells } from './constants';
import { inBounds, positionToIndex, samePosition } from './neighbors';
import type { Cell, GameState, GameStats, Position, SliceState } from './types';

export function getCell(state: GameState, position: Position): Cell | null {
  if (!state.map) return null;
  const { dims } = state.map;
  if (!inBounds(dims, position)) return null;
  return state.map.cells[positionToIndex(dims, position)] ?? null;
}

/**
 * 终点位置此刻是否应该对玩家可见。
 * 难度可以把终点藏起来，但**一局结束后无条件显示**，否则没法复盘。
 */
export function shouldShowEnd(state: GameState): boolean {
  if (state.config.difficulty.showEndPosition) return true;
  return state.status === 'won' || state.status === 'lost';
}

export function countExplored(cells: readonly Cell[]): number {
  let count = 0;
  for (const cell of cells) if (cell.explored) count += 1;
  return count;
}

export function countFlags(cells: readonly Cell[]): number {
  let count = 0;
  for (const cell of cells) if (cell.mark === 'flag') count += 1;
  return count;
}

export function countRevealedMines(cells: readonly Cell[]): number {
  let count = 0;
  for (const cell of cells) if (cell.revealedMine) count += 1;
  return count;
}

/**
 * 路线效率 = 最短安全路径长度 / 玩家实际成功移动步数，限制在 0%~100%。
 * 玩家有回头路时效率下降。
 */
export function routeEfficiency(shortestPathLength: number, moves: number): number {
  if (shortestPathLength <= 0 || moves <= 0) return 0;
  return Math.max(0, Math.min(1, shortestPathLength / moves));
}

export function computeStats(state: GameState): GameStats | null {
  if (!state.map) return null;
  const { map } = state;
  const total = totalCells(map.dims);
  const exploredCount = countExplored(map.cells);

  return {
    elapsedMs: state.elapsedMs,
    moves: state.moves,
    mineHits: state.mineHits,
    livesLeft: state.lives,
    initialLives: state.initialLives,
    exploredCount,
    totalCells: total,
    exploredRatio: total === 0 ? 0 : exploredCount / total,
    flagCount: countFlags(map.cells),
    revealedMineCount: countRevealedMines(map.cells),
    shortestPathLength: map.shortestPathLength,
    routeEfficiency: routeEfficiency(map.shortestPathLength, state.moves),
    dims: map.dims,
    mineCount: map.mineCount,
    rockCount: map.rockCount,
    seed: state.config.seed,
    seedValue: map.seedValue,
    difficultyCoefficient: difficultyCoefficient(state.config),
  };
}

export type CellVisualKind =
  | 'player'
  | 'mine'
  | 'rock'
  | 'start'
  | 'end'
  | 'flag'
  /** 玩家标的问号：只是「拿不准」，不构成断言 */
  | 'unsure'
  /** 揭示阶段：插旗且确实是雷（标对了） */
  | 'flag-correct'
  /** 揭示阶段：插了旗但那里没有雷（标错了） */
  | 'flag-wrong'
  | 'explored'
  | 'unknown';

export interface CellVisual {
  kind: CellVisualKind;
  /** 是否位于当前切片层内 */
  inSlice: boolean;
  /** 是否需要渲染 */
  visible: boolean;
  label: string;
}

/** 该格是否属于「已知信息」，用于“只显示已探索区域”过滤。岩块从一开始就可见。 */
export function isKnownCell(
  cell: Cell,
  player: Position,
  start: Position,
  end: Position,
  showEnd = true,
): boolean {
  return (
    cell.explored ||
    cell.mark !== 'none' ||
    cell.revealedMine ||
    cell.type === 'rock' ||
    samePosition(cell.position, player) ||
    samePosition(cell.position, start) ||
    (showEnd && samePosition(cell.position, end))
  );
}

/**
 * 聚焦半径过滤：只保留玩家周围切比雪夫距离 <= radius 的格子。
 * radius 为 0 表示不限制。1 就是玩家所在的 3×3×3。
 */
export function isInFocus(position: Position, player: Position, radius: number): boolean {
  if (radius <= 0) return true;
  return (
    Math.abs(position.x - player.x) <= radius &&
    Math.abs(position.y - player.y) <= radius &&
    Math.abs(position.z - player.z) <= radius
  );
}

export function isInSlice(position: Position, slice: SliceState): boolean {
  switch (slice.axis) {
    case 'x':
      return position.x === slice.level;
    case 'y':
      return position.y === slice.level;
    case 'z':
      return position.z === slice.level;
    default:
      return true;
  }
}

/**
 * 计算一个格子的视觉状态（纯函数，渲染层直接消费）。
 * 优先级：玩家 > 地雷 > 起点 > 终点 > 旗帜 > 已探索 > 未知。
 */
export function getCellVisual(
  cell: Cell,
  options: {
    player: Position;
    start: Position;
    end: Position;
    slice: SliceState;
    revealAllMines: boolean;
    /** 难度修正：是否显示终点位置 */
    showEnd?: boolean;
    /** 难度修正：终点未探索时是否也显示它的邻域雷数 */
    showEndNumber?: boolean;
    /** 难度修正：是否额外显示六邻域雷数 */
    showOrthogonalCount?: boolean;
  },
): CellVisual {
  const { player, start, end, slice, revealAllMines } = options;
  const showEnd = options.showEnd ?? true;
  const inSlice = isInSlice(cell.position, slice);
  const known = isKnownCell(cell, player, start, end, showEnd);
  const mineVisible = cell.revealedMine || (revealAllMines && cell.type === 'mine');

  const isStart = samePosition(cell.position, start);
  // 隐藏终点时，终点在被探索（也就是被走到）之前和普通未探索格没有区别
  const isEnd = samePosition(cell.position, end) && (showEnd || cell.explored);
  // 起点 / 终点用角标表示身份，数字仍然照常显示，
  // 否则玩家离开起点后就再也看不到起点的邻域雷数了。
  const badge = isStart ? 'S' : isEnd ? 'E' : '';
  const withBadge = (cellRef: Cell) => {
    // 开启六邻域数字后，标签变成「26 邻域数 ~ 六邻域数」
    const base = options.showOrthogonalCount
      ? `${cellRef.adjacentMineCount}~${cellRef.orthogonalMineCount}`
      : String(cellRef.adjacentMineCount);
    return badge ? `${base}@${badge}` : base;
  };

  let kind: CellVisualKind = 'unknown';
  let label = '';

  if (samePosition(cell.position, player)) {
    kind = 'player';
    label = withBadge(cell);
  } else if (cell.type === 'rock') {
    // 岩块是地形，从一开始就完全可见。它是唯一完全不透明的格子，
    // 靠"实心 + 亮边框"与半透明的雷区格子区分，不需要文字标签。
    kind = 'rock';
    label = '';
  } else if (mineVisible) {
    // 揭示阶段要能一眼看出旗标得对不对：
    // 插旗且确实是雷 = 标对；踩过的雷旗帜已被自动清掉，显示为漏掉的雷
    kind = cell.mark === 'flag' ? 'flag-correct' : 'mine';
    label = cell.mark === 'flag' ? 'flag-ok' : 'mine';
  } else if (isStart) {
    kind = 'start';
    label = cell.explored ? withBadge(cell) : 'S';
  } else if (isEnd) {
    // 终点未探索时默认只显示 E：它的邻域雷数属于玩家尚未获得的信息。
    // 「显示终点数字」是一个降低难度的修正项。
    kind = 'end';
    label = cell.explored || options.showEndNumber ? withBadge(cell) : 'E';
  } else if (cell.mark === 'flag') {
    // 揭示阶段还留着旗、但这里并不是雷 —— 标错了
    kind = revealAllMines ? 'flag-wrong' : 'flag';
    label = revealAllMines ? 'flag-bad' : 'flag';
  } else if (cell.mark === 'unsure') {
    // 问号只是玩家自己的备忘，揭示阶段也不判定对错
    kind = 'unsure';
    label = 'unsure';
  } else if (cell.explored) {
    kind = 'explored';
    label = withBadge(cell);
  }

  // 聚焦半径：范围外的格子直接隐藏。
  // 起点和终点是玩家已知的导航锚点，保留下来，否则远距离寻路会完全失去参照。
  const inFocus = isInFocus(cell.position, player, slice.focusRadius) || isStart || isEnd;
  const visible = (slice.onlyExplored ? known || mineVisible : true) && inFocus;
  return { kind, inSlice, visible, label };
}
