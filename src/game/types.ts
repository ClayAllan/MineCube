/**
 * Minecube 核心类型定义。
 * 这一层是纯数据 / 纯逻辑，不依赖 React 与 Three.js。
 */

/** 三维整数坐标，取值范围 0 <= v < size */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/** 地图三个方向的尺寸，各维独立，不要求相等 */
export interface Dims {
  x: number;
  y: number;
  z: number;
}

/**
 * 格子类型。
 * rock 是不可通行的实心岩块：它不是地雷，不计入任何邻域雷数，撞上去也不扣血，
 * 但它从一开始就可见，并且永远挡路 —— 用来让「寻路」这件事真正有分量。
 */
export type CellType = 'safe' | 'mine' | 'start' | 'end' | 'rock';

/**
 * 玩家自己打在格子上的标记。
 * - `flag` 是断言「这里有雷」：计入剩余雷数，阻挡移动，推理时当作雷；
 * - `unsure` 只是「我拿不准」：不计数、不阻挡移动，推理时仍然当作未知格。
 */
export type CellMark = 'none' | 'flag' | 'unsure';

export interface Cell {
  position: Position;
  type: CellType;
  /** 以该格为中心的 3x3x3 区域（不含自身）内的地雷数量，取值 0~26，地图生成时预计算 */
  adjacentMineCount: number;
  /**
   * 六个正交邻格中的地雷数量，取值 0~6，地图生成时预计算。
   * 26 邻域在三维里太粗（内部格「5/26」几乎没有约束力），这个更细的数字是可选规则，
   * 由难度修正项 showOrthogonalCount 控制是否对玩家可见。
   */
  orthogonalMineCount: number;
  /** 玩家是否已经进入过该格 */
  explored: boolean;
  /** 玩家自己打的标记 */
  mark: CellMark;
  /** 玩家踩中并被永久揭示的地雷 */
  revealedMine: boolean;
}

/** 六个正交方向的标识 */
export type DirectionId = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

export interface Direction {
  id: DirectionId;
  /** 键盘按键（大写） */
  key: string;
  /** 中文方向名 */
  label: string;
  /** 坐标轴说明，例如 "Z −" */
  axisLabel: string;
  delta: Position;
}

/**
 * 难度修正项。
 * 这些开关不改变地图本身，只改变玩家能拿到多少信息，
 * 因此可以独立于尺寸 / 密度 / 生命之外调整难度。
 */
export interface DifficultyOptions {
  /** 是否从开局就显示终点位置 */
  showEndPosition: boolean;
  /** 是否显示终点格的邻域雷数（默认不显示，因为它本该是未探索信息） */
  showEndNumber: boolean;
  /**
   * 是否额外显示「六邻域雷数」。
   * 开启后每个已探索格会显示两个数字：26 邻域雷数 + 六方向邻域雷数。
   * 后者只覆盖 6 个格子，约束强得多，也直接对应玩家能走的六个方向，
   * 是让立方体内部真正可推理的关键规则。
   */
  showOrthogonalCount: boolean;
  /** 开局在起点周围预先探索的半径（切比雪夫距离），0~2 */
  prescoutRadius: number;
  /** 是否允许使用推理分析面板 */
  allowAnalysis: boolean;
}

/** 玩家在开始界面设置的地图参数 */
export interface MapConfig {
  /** 地图尺寸，每个方向 3~10，不要求是立方体 */
  dims: Dims;
  /** 地雷密度，范围 0.05~0.2 */
  mineDensity: number;
  /** 岩块密度，范围 0~0.15，默认 0（不生成岩块） */
  rockDensity: number;
  /** 初始生命，范围 1~9 */
  lives: number;
  /** 随机种子，允许数字或短字符串 */
  seed: string;
  /** 难度修正项 */
  difficulty: DifficultyOptions;
  /** 使用的难度预设 id，仅用于展示 */
  presetId: string;
}

export interface GameMap {
  dims: Dims;
  /** 扁平化存储，索引 = x + y * dims.x + z * dims.x * dims.y */
  cells: Cell[];
  start: Position;
  end: Position;
  /** 实际放置的地雷数量 */
  mineCount: number;
  /** 实际放置的岩块数量 */
  rockCount: number;
  /** 起点到终点的最短安全路径「步数」（BFS，六方向） */
  shortestPathLength: number;
  /** 由种子字符串哈希得到的数字种子 */
  seedValue: number;
  /** 地雷布局尝试次数 */
  attempts: number;
  /** 是否使用了"先铺安全路径"的后备方案 */
  usedFallback: boolean;
}

/** 主视图模式：轨道环绕 vs 第一人称闯关 */
export type ViewMode = 'orbit' | 'first-person';

export type GameStatus = 'setup' | 'playing' | 'paused' | 'won' | 'lost';

/** 切片查看的轴，'none' 表示显示完整立方体 */
export type SliceAxis = 'none' | 'x' | 'y' | 'z';

export interface SliceState {
  axis: SliceAxis;
  level: number;
  /** 只显示已探索 / 已知区域 */
  onlyExplored: boolean;
  /**
   * 聚焦半径（切比雪夫距离）：只显示玩家周围 (2r+1)³ 的格子，0 表示不限制。
   * 1 = 3×3×3，2 = 5×5×5，3 = 7×7×7。与切片过滤是「同时满足」的关系。
   */
  focusRadius: number;
}

export type FeedbackType =
  | 'move'
  | 'blocked'
  | 'flag-blocked'
  | 'mine-blocked'
  | 'mine'
  | 'flag'
  | 'unflag'
  | 'win'
  | 'lose';

/** 分析模式：玩家挑选若干已探索的数字格作为线索，工具把重叠区域和确定结论摊开 */
export interface AnalysisState {
  enabled: boolean;
  /** 被选为线索的格子 */
  clues: Position[];
  /** 只显示线索格与它们的重叠区域，其余隐藏 */
  onlyOverlap: boolean;
}

export interface Feedback {
  /** 自增 id，保证同类型事件也能触发副作用 */
  id: number;
  type: FeedbackType;
  message: string;
}

export interface GameState {
  status: GameStatus;
  /** 每开始一局自增，用于重置相机等一次性副作用 */
  gameId: number;
  config: MapConfig;
  map: GameMap | null;
  player: Position;
  lives: number;
  initialLives: number;
  /** 成功移动的步数 */
  moves: number;
  /** 踩雷次数 */
  mineHits: number;
  /** 计时：正在计时的起点时间戳，暂停时为 null */
  runningSince: number | null;
  /** 计时：暂停前累计的毫秒数 */
  accumulatedMs: number;
  /** 计时：用于渲染的已用毫秒数 */
  elapsedMs: number;
  slice: SliceState;
  analysis: AnalysisState;
  selected: Position | null;
  /** 是否揭示全部地雷（失败时自动开启，胜利后可手动开启） */
  revealAllMines: boolean;
  soundEnabled: boolean;
  /** 相机相对移动：W 表示「远离相机」而不是固定的 Z− */
  cameraRelative: boolean;
  /** 主视图模式；第一人称下移动强制相对相机 */
  viewMode: ViewMode;
  feedback: Feedback | null;
  /** 相机聚焦玩家的令牌，每次自增触发一次聚焦 */
  focusToken: number;
  /** 地图生成等错误信息，展示在开始界面 */
  error: string | null;
}

/** 结算统计 */
export interface GameStats {
  elapsedMs: number;
  moves: number;
  mineHits: number;
  livesLeft: number;
  initialLives: number;
  exploredCount: number;
  totalCells: number;
  exploredRatio: number;
  flagCount: number;
  revealedMineCount: number;
  shortestPathLength: number;
  routeEfficiency: number;
  dims: Dims;
  mineCount: number;
  rockCount: number;
  seed: string;
  seedValue: number;
  /** 难度系数，普通模式的默认配置为 1.00 */
  difficultyCoefficient: number;
}
