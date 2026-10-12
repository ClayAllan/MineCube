import type { AnalysisResult } from './analysis';
import { DIRECTIONS } from './constants';
import { addDelta, inBounds, positionToIndex, samePosition } from './neighbors';
import type { Direction, GameMap, Position } from './types';

/**
 * 六方向风险评估。
 *
 * 玩家每一步真正在问的问题是「我下一步往哪走安全」，而不是「哪个格子是雷」。
 * 这里把推理结果直接翻译成六个方向的可行性与风险，供移动按钮和面板直接消费。
 */

export type MoveRiskKind =
  | 'out-of-bounds'
  | 'rock'
  | 'flagged'
  | 'revealed-mine'
  | 'known-safe'
  | 'safe'
  | 'mine'
  | 'risky'
  | 'unknown';

export interface MoveRisk {
  kind: MoveRiskKind;
  /** 含雷概率；仅 risky 有意义 */
  probability: number;
  /** 概率是精确枚举得到的 */
  exact: boolean;
  /** 该方向是否可以尝试移动 */
  passable: boolean;
  label: string;
}

export interface DirectionRisk {
  direction: Direction;
  target: Position | null;
  risk: MoveRisk;
}

function risk(
  kind: MoveRiskKind,
  label: string,
  passable: boolean,
  probability = 0,
  exact = false,
): MoveRisk {
  return { kind, label, passable, probability, exact };
}

export interface MoveRiskOptions {
  /** 玩家是否知道终点位置 */
  endKnown?: boolean;
}

export function evaluateMove(
  map: GameMap,
  target: Position,
  analysis: AnalysisResult,
  options: MoveRiskOptions = {},
): MoveRisk {
  const endKnown = options.endKnown ?? true;
  if (!inBounds(map.dims, target)) return risk('out-of-bounds', '边界', false);

  const index = positionToIndex(map.dims, target);
  const cell = map.cells[index]!;

  if (cell.type === 'rock') return risk('rock', '岩块', false);
  if (cell.revealedMine) return risk('revealed-mine', '已知雷', false);
  // 问号不阻挡移动，只有旗帜才拦
  if (cell.mark === 'flag') return risk('flagged', '已插旗', false);
  if (cell.explored) return risk('known-safe', '已探索', true);
  if (endKnown && samePosition(target, map.end)) return risk('known-safe', '终点', true);
  if (samePosition(target, map.start)) return risk('known-safe', '起点', true);

  const state = analysis.cells.get(index);
  if (!state) return risk('unknown', '未知', true);
  if (state.verdict === 'safe') return risk('safe', '安全', true, 0, state.exact);
  if (state.verdict === 'mine') return risk('mine', '有雷', true, 1, state.exact);

  return risk(
    'risky',
    `${Math.round(state.probability * 100)}%`,
    true,
    state.probability,
    state.exact,
  );
}

/** 玩家六个方向的风险，顺序与 DIRECTIONS 一致 */
export function computeMoveRisks(
  map: GameMap,
  player: Position,
  analysis: AnalysisResult,
  options: MoveRiskOptions = {},
): DirectionRisk[] {
  return DIRECTIONS.map((direction) => {
    const target = addDelta(player, direction.delta);
    const inside = inBounds(map.dims, target);
    return {
      direction,
      target: inside ? target : null,
      risk: evaluateMove(map, target, analysis, options),
    };
  });
}

/**
 * 从六个方向里挑出最值得走的一步。
 * 优先级：确定安全 > 概率最低 > 已探索（回头路）；全部不可通行时返回 null。
 */
export function bestMove(risks: readonly DirectionRisk[]): DirectionRisk | null {
  const score = (entry: DirectionRisk): number => {
    const { kind, probability } = entry.risk;
    if (!entry.risk.passable) return Number.POSITIVE_INFINITY;
    if (kind === 'safe') return -1;
    // 已探索格绝对安全，但走回头路没有信息收益，排在新的安全格之后
    if (kind === 'known-safe') return -0.5;
    if (kind === 'mine') return Number.POSITIVE_INFINITY;
    if (kind === 'unknown') return 0.5;
    return probability;
  };

  let best: DirectionRisk | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of risks) {
    const value = score(entry);
    if (value < bestScore) {
      bestScore = value;
      best = entry;
    }
  }
  return best && bestScore !== Number.POSITIVE_INFINITY ? best : null;
}

/** 风险等级，用于配色（不依赖颜色单独传达信息，文字仍然给出具体数值） */
export function riskLevel(risk: MoveRisk): 'safe' | 'low' | 'mid' | 'high' | 'mine' | 'none' {
  if (risk.kind === 'safe' || risk.kind === 'known-safe') return 'safe';
  if (risk.kind === 'mine') return 'mine';
  if (risk.kind !== 'risky') return 'none';
  if (risk.probability < 0.15) return 'low';
  if (risk.probability < 0.4) return 'mid';
  return 'high';
}
