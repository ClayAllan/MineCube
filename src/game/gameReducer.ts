import { isClueCandidate } from './analysis';
import { DEFAULT_CONFIG, DIRECTIONS, MAX_FOCUS_RADIUS } from './constants';
import { generateMap, normalizeConfig } from './mapGenerator';
import { addDelta, inBounds, positionToIndex, samePosition } from './neighbors';
import { randomSeedString } from './seededRandom';
import type {
  Cell,
  CellMark,
  Dims,
  GameMap,
  DirectionId,
  Feedback,
  FeedbackType,
  GameState,
  MapConfig,
  Position,
  SliceAxis,
  ViewMode,
} from './types';

/** 某个切片轴上的层数；'none' 时按最长边处理 */
export function axisLength(dims: Dims, axis: SliceAxis): number {
  if (axis === 'x') return dims.x;
  if (axis === 'y') return dims.y;
  if (axis === 'z') return dims.z;
  return Math.max(dims.x, dims.y, dims.z);
}

export type GameAction =
  | { type: 'START_GAME'; config: Partial<MapConfig>; now?: number }
  | { type: 'RESTART_SAME_SEED'; now?: number }
  | { type: 'NEW_MAP'; seed?: string; now?: number }
  | { type: 'BACK_TO_SETUP' }
  | { type: 'MOVE'; direction: DirectionId }
  | { type: 'TOGGLE_FLAG'; position: Position }
  | { type: 'SELECT_CELL'; position: Position | null }
  /** 沿六方向移动「选中格光标」，不移动玩家 */
  | { type: 'MOVE_CURSOR'; direction: DirectionId }
  | { type: 'CURSOR_TO_PLAYER' }
  | { type: 'SET_SLICE_AXIS'; axis: SliceAxis; level?: number }
  | { type: 'SET_SLICE_LEVEL'; level: number }
  | { type: 'JUMP_TO_PLAYER_LAYER' }
  | { type: 'SET_ONLY_EXPLORED'; value: boolean }
  | { type: 'SET_FOCUS_RADIUS'; value: number }
  | { type: 'SET_ANALYSIS'; value: boolean }
  | { type: 'TOGGLE_CLUE'; position: Position }
  | { type: 'CLEAR_CLUES' }
  | { type: 'SET_ONLY_OVERLAP'; value: boolean }
  | { type: 'RESET_VIEW' }
  | { type: 'FOCUS_PLAYER' }
  | { type: 'PAUSE'; now?: number }
  | { type: 'RESUME'; now?: number }
  | { type: 'TICK'; now: number }
  | { type: 'SET_REVEAL_ALL'; value: boolean }
  | { type: 'SET_SOUND'; value: boolean }
  | { type: 'SET_CAMERA_RELATIVE'; value: boolean }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'DISMISS_ERROR' };

let feedbackCounter = 0;

function makeFeedback(type: FeedbackType, message: string): Feedback {
  feedbackCounter += 1;
  return { id: feedbackCounter, type, message };
}

export function createInitialState(config: Partial<MapConfig> = DEFAULT_CONFIG): GameState {
  const normalized = normalizeConfig(config);
  return {
    status: 'setup',
    gameId: 0,
    config: normalized,
    map: null,
    player: { x: 0, y: 0, z: 0 },
    lives: normalized.lives,
    initialLives: normalized.lives,
    moves: 0,
    mineHits: 0,
    runningSince: null,
    accumulatedMs: 0,
    elapsedMs: 0,
    slice: { axis: 'none', level: 0, onlyExplored: false, focusRadius: 0 },
    analysis: { enabled: false, clues: [], onlyOverlap: false },
    selected: null,
    revealAllMines: false,
    soundEnabled: true,
    cameraRelative: false,
    viewMode: 'orbit',
    feedback: null,
    focusToken: 0,
    error: null,
  };
}

/**
 * 开局预探索：把起点周围切比雪夫距离 <= radius 的安全格直接标记为已探索。
 * 地雷保持隐藏——玩家得到的是一圈数字，而不是答案。
 */
function applyPrescout(map: GameMap, radius: number): GameMap {
  if (radius <= 0) return map;
  const cells = map.cells.slice();
  const { start, dims } = map;
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const p = { x: start.x + dx, y: start.y + dy, z: start.z + dz };
        if (!inBounds(dims, p)) continue;
        const index = positionToIndex(dims, p);
        const cell = cells[index]!;
        // 终点的探索状态独立于是否显示位置；预探索不能提前暴露终点身份或数字。
        if (cell.type === 'mine' || cell.type === 'rock' || cell.type === 'end' || cell.explored) continue;
        cells[index] = { ...cell, explored: true };
      }
    }
  }
  return { ...map, cells };
}

/** 用给定配置开始一局游戏；地图生成失败时回到设置界面并给出错误信息 */
export function startGame(state: GameState, config: Partial<MapConfig>, now: number): GameState {
  const normalized = normalizeConfig(config);
  try {
    const generated = generateMap({
      dims: normalized.dims,
      mineDensity: normalized.mineDensity,
      rockDensity: normalized.rockDensity,
      seed: normalized.seed,
    });
    const map = applyPrescout(generated, normalized.difficulty.prescoutRadius);

    return {
      ...createInitialState(normalized),
      status: 'playing',
      gameId: state.gameId + 1,
      config: normalized,
      map,
      player: { ...map.start },
      lives: normalized.lives,
      initialLives: normalized.lives,
      runningSince: now,
      accumulatedMs: 0,
      elapsedMs: 0,
      // 视图偏好（切片轴复位，但聚焦半径沿用上一局）
      slice: {
        axis: 'none',
        level: 0,
        onlyExplored: false,
        focusRadius: state.slice.focusRadius,
      },
      // 分析模式的开关沿用上一局，但线索要清空；难度不允许时强制关闭
      analysis: {
        ...state.analysis,
        enabled: normalized.difficulty.allowAnalysis && state.analysis.enabled,
        clues: [],
      },
      soundEnabled: state.soundEnabled,
      cameraRelative: state.cameraRelative,
      viewMode: state.viewMode,
      selected: { ...map.start },
    };
  } catch (err) {
    return {
      ...state,
      status: 'setup',
      map: null,
      error: `地图生成失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 不可变地替换单个格子 */
function withCell(cells: Cell[], index: number, patch: Partial<Cell>): Cell[] {
  const next = cells.slice();
  next[index] = { ...next[index]!, ...patch };
  return next;
}

function stopTimer(state: GameState, now: number): Pick<GameState, 'runningSince' | 'accumulatedMs' | 'elapsedMs'> {
  const accumulated = state.accumulatedMs + (state.runningSince === null ? 0 : now - state.runningSince);
  return { runningSince: null, accumulatedMs: accumulated, elapsedMs: accumulated };
}

function handleMove(state: GameState, direction: DirectionId, now: number): GameState {
  if (state.status !== 'playing' || !state.map) return state;

  const dir = DIRECTIONS.find((d) => d.id === direction);
  if (!dir) return state;

  const { map } = state;
  const target = addDelta(state.player, dir.delta);

  if (!inBounds(map.dims, target)) {
    return { ...state, feedback: makeFeedback('blocked', '前方是地图边界，无法移动') };
  }

  const targetIndex = positionToIndex(map.dims, target);
  const targetCell = map.cells[targetIndex]!;

  // 岩块是纯地形障碍：挡路但不是雷，撞上去不扣血
  if (targetCell.type === 'rock') {
    return { ...state, feedback: makeFeedback('blocked', '那里是实心岩块，无法通行') };
  }

  // 已插旗的格子必须先取消旗帜才能进入
  // 只有旗帜拦路；问号只是提醒，不阻挡移动
  if (targetCell.mark === 'flag') {
    return {
      ...state,
      feedback: makeFeedback('flag-blocked', '目标格已插旗，请先取消旗帜再进入'),
    };
  }

  // 已揭示的地雷视为不可通行障碍，不再重复扣血
  if (targetCell.revealedMine) {
    return {
      ...state,
      feedback: makeFeedback('mine-blocked', '那里是已揭示的地雷，无法通行'),
    };
  }

  if (targetCell.type === 'mine') {
    // 踩雷：扣血、永久揭示、移除旗帜，但玩家停留在原地
    const lives = state.lives - 1;
    const cells = withCell(map.cells, targetIndex, { revealedMine: true, mark: 'none' });
    const lost = lives <= 0;
    const revealedCells = lost
      ? cells.map((cell) => (cell.type === 'mine' ? { ...cell, revealedMine: true } : cell))
      : cells;

    const base: GameState = {
      ...state,
      map: { ...map, cells: revealedCells },
      lives: Math.max(0, lives),
      mineHits: state.mineHits + 1,
      feedback: makeFeedback(
        lost ? 'lose' : 'mine',
        lost ? '生命已耗尽' : `踩中地雷！剩余生命 ${Math.max(0, lives)}`,
      ),
    };

    if (lost) {
      return { ...base, status: 'lost', revealAllMines: true, ...stopTimer(state, now) };
    }
    return base;
  }

  // 安全格：进入并永久记录已探索状态
  const cells = withCell(map.cells, targetIndex, { explored: true, mark: 'none' });
  const nextState: GameState = {
    ...state,
    map: { ...map, cells },
    player: target,
    moves: state.moves + 1,
    // 注意：不修改 selected。选中格是玩家自己控制的「光标」，
    // 如果每次移动都把它拖到玩家身上，F 键就永远只能作用在已探索格上（等于失效）。
    feedback: makeFeedback('move', `移动到 (${target.x}, ${target.y}, ${target.z})`),
  };

  if (targetCell.type === 'end') {
    return {
      ...nextState,
      status: 'won',
      feedback: makeFeedback('win', '成功抵达终点'),
      ...stopTimer(state, now),
    };
  }

  return nextState;
}

function handleToggleFlag(state: GameState, position: Position): GameState {
  if (state.status !== 'playing' || !state.map) return state;
  const { map } = state;
  if (!inBounds(map.dims, position)) return state;

  const index = positionToIndex(map.dims, position);
  const cell = map.cells[index]!;

  // 终点被难度修正藏起来时，它在玩家眼里就是一个普通未探索格，必须允许插旗，
  // 否则「这一格不能插旗」本身就泄露了终点位置
  const endIsHidden = !state.config.difficulty.showEndPosition && !cell.explored;

  // 只能给未探索、未揭示的格子做标记；已探索安全格、岩块、已揭示地雷、起点（以及可见的终点）均不可标记
  if (
    cell.explored ||
    cell.revealedMine ||
    cell.type === 'rock' ||
    (cell.type === 'end' && !endIsHidden) ||
    cell.type === 'start'
  ) {
    return {
      ...state,
      feedback: makeFeedback('blocked', '该格无需标记'),
    };
  }
  if (samePosition(position, state.player)) return state;

  // 经典扫雷的三态循环：无 → 旗（断言有雷）→ 问号（拿不准）→ 无
  const next: CellMark = cell.mark === 'none' ? 'flag' : cell.mark === 'flag' ? 'unsure' : 'none';
  const at = `(${position.x}, ${position.y}, ${position.z})`;
  const message =
    next === 'flag' ? `已在 ${at} 插旗` : next === 'unsure' ? `已把 ${at} 标为不确定` : `已清除 ${at} 的标记`;

  return {
    ...state,
    map: { ...map, cells: withCell(map.cells, index, { mark: next }) },
    selected: position,
    feedback: makeFeedback(next === 'none' ? 'unflag' : 'flag', message),
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return startGame(state, action.config, action.now ?? Date.now());

    case 'RESTART_SAME_SEED':
      return startGame(state, state.config, action.now ?? Date.now());

    case 'NEW_MAP':
      return startGame(
        state,
        { ...state.config, seed: action.seed ?? randomSeedString() },
        action.now ?? Date.now(),
      );

    case 'BACK_TO_SETUP':
      return {
        ...createInitialState(state.config),
        gameId: state.gameId,
        soundEnabled: state.soundEnabled,
        cameraRelative: state.cameraRelative,
        viewMode: state.viewMode,
      };

    case 'MOVE':
      return handleMove(state, action.direction, Date.now());

    case 'TOGGLE_FLAG':
      return handleToggleFlag(state, action.position);

    case 'SELECT_CELL':
      return { ...state, selected: action.position };

    case 'MOVE_CURSOR': {
      // 光标可以自由穿过任何格子，因此内部格也能被选中并插旗，
      // 不受 3D 射线拾取「只能命中最外层」的限制。
      if (!state.map) return state;
      const dir = DIRECTIONS.find((d) => d.id === action.direction);
      if (!dir) return state;
      const origin = state.selected ?? state.player;
      const target = addDelta(origin, dir.delta);
      if (!inBounds(state.map.dims, target)) {
        return { ...state, feedback: makeFeedback('blocked', '光标已到地图边界') };
      }
      return { ...state, selected: target };
    }

    case 'CURSOR_TO_PLAYER':
      return { ...state, selected: { ...state.player } };

    case 'SET_SLICE_AXIS': {
      if (!state.map) return state;
      const maxLevel = axisLength(state.map.dims, action.axis) - 1;
      const fallback =
        action.axis === 'x' ? state.player.x : action.axis === 'y' ? state.player.y : state.player.z;
      const level = Math.min(maxLevel, Math.max(0, action.level ?? fallback));
      return { ...state, slice: { ...state.slice, axis: action.axis, level } };
    }

    case 'SET_SLICE_LEVEL': {
      if (!state.map) return state;
      const maxLevel = axisLength(state.map.dims, state.slice.axis) - 1;
      const level = Math.min(maxLevel, Math.max(0, Math.round(action.level)));
      return { ...state, slice: { ...state.slice, level } };
    }

    case 'JUMP_TO_PLAYER_LAYER': {
      if (!state.map || state.slice.axis === 'none') return state;
      const level =
        state.slice.axis === 'x'
          ? state.player.x
          : state.slice.axis === 'y'
            ? state.player.y
            : state.player.z;
      return { ...state, slice: { ...state.slice, level } };
    }

    case 'SET_ONLY_EXPLORED':
      return { ...state, slice: { ...state.slice, onlyExplored: action.value } };

    case 'SET_FOCUS_RADIUS': {
      const value = Math.min(MAX_FOCUS_RADIUS, Math.max(0, Math.round(action.value)));
      return { ...state, slice: { ...state.slice, focusRadius: value } };
    }

    case 'SET_ANALYSIS':
      if (!state.config.difficulty.allowAnalysis) return state;
      return {
        ...state,
        analysis: { ...state.analysis, enabled: action.value },
      };

    case 'TOGGLE_CLUE': {
      if (!state.map || !inBounds(state.map.dims, action.position)) return state;
      const cell = state.map.cells[positionToIndex(state.map.dims, action.position)]!;
      // 只有数字已经可见的格子才能当线索
      if (!isClueCandidate(cell, state.player)) {
        return { ...state, feedback: makeFeedback('blocked', '只有已探索的数字格才能作为线索') };
      }
      const exists = state.analysis.clues.some((p) => samePosition(p, action.position));
      const clues = exists
        ? state.analysis.clues.filter((p) => !samePosition(p, action.position))
        : [...state.analysis.clues, { ...action.position }];
      return { ...state, analysis: { ...state.analysis, clues } };
    }

    case 'CLEAR_CLUES':
      return { ...state, analysis: { ...state.analysis, clues: [] } };

    case 'SET_ONLY_OVERLAP':
      return { ...state, analysis: { ...state.analysis, onlyOverlap: action.value } };

    case 'RESET_VIEW':
      return {
        ...state,
        slice: { axis: 'none', level: state.slice.level, onlyExplored: false, focusRadius: 0 },
      };

    case 'FOCUS_PLAYER':
      return { ...state, focusToken: state.focusToken + 1 };

    case 'PAUSE': {
      if (state.status !== 'playing') return state;
      return { ...state, status: 'paused', ...stopTimer(state, action.now ?? Date.now()) };
    }

    case 'RESUME': {
      if (state.status !== 'paused') return state;
      return { ...state, status: 'playing', runningSince: action.now ?? Date.now() };
    }

    case 'TICK': {
      if (state.status !== 'playing' || state.runningSince === null) return state;
      const elapsed = state.accumulatedMs + (action.now - state.runningSince);
      if (elapsed === state.elapsedMs) return state;
      return { ...state, elapsedMs: elapsed };
    }

    case 'SET_REVEAL_ALL': {
      if (!state.map) return state;
      return { ...state, revealAllMines: action.value };
    }

    case 'SET_SOUND':
      return { ...state, soundEnabled: action.value };

    case 'SET_CAMERA_RELATIVE':
      return { ...state, cameraRelative: action.value };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };

    case 'DISMISS_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}
