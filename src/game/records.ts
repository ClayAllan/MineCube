import { difficultyCoefficient } from './constants';
import type { MapConfig } from './types';

/**
 * 本地最佳记录。
 *
 * 记录按「配置签名」分组 —— 种子不参与签名，因为同一套设置换个种子仍然是同一种挑战，
 * 但换了尺寸 / 密度 / 生命 / 难度修正项就是完全不同的难度，不应该混在一起比较。
 */

export interface GameRecord {
  signature: string;
  /** 最佳通关用时（毫秒），还没赢过时为 null */
  bestTimeMs: number | null;
  /** 最佳路线效率 0~1 */
  bestEfficiency: number | null;
  /** 最少通关步数 */
  bestMoves: number | null;
  wins: number;
  losses: number;
  /** 该配置的难度系数，用于展示 */
  difficultyCoefficient: number;
  /** 最后一次游玩的时间戳 */
  updatedAt: number;
}

export type RecordBook = Record<string, GameRecord>;

export interface GameOutcome {
  won: boolean;
  elapsedMs: number;
  moves: number;
  routeEfficiency: number;
  now?: number;
}

/** 哪些项目刷新了纪录 */
export interface RecordImprovements {
  time: boolean;
  efficiency: boolean;
  moves: boolean;
  /** 该配置的第一次通关 */
  firstWin: boolean;
}

export const NO_IMPROVEMENTS: RecordImprovements = {
  time: false,
  efficiency: false,
  moves: false,
  firstWin: false,
};

export function configSignature(config: MapConfig): string {
  const { dims, difficulty } = config;
  const flags = [
    difficulty.showEndPosition ? 1 : 0,
    difficulty.showEndNumber ? 1 : 0,
    difficulty.showOrthogonalCount ? 1 : 0,
    difficulty.prescoutRadius,
    difficulty.allowAnalysis ? 1 : 0,
  ].join('');
  return [
    `${dims.x}x${dims.y}x${dims.z}`,
    `m${Math.round(config.mineDensity * 100)}`,
    `r${Math.round(config.rockDensity * 100)}`,
    `l${config.lives}`,
    `d${flags}`,
  ].join('|');
}

export function emptyRecord(config: MapConfig, now = Date.now()): GameRecord {
  return {
    signature: configSignature(config),
    bestTimeMs: null,
    bestEfficiency: null,
    bestMoves: null,
    wins: 0,
    losses: 0,
    difficultyCoefficient: difficultyCoefficient(config),
    updatedAt: now,
  };
}

export function getRecord(book: RecordBook, config: MapConfig): GameRecord | null {
  return book[configSignature(config)] ?? null;
}

/**
 * 把一局结果并入记录簿。
 * 返回新的记录簿（不修改入参）以及本局刷新了哪些纪录。
 */
export function applyResult(
  book: RecordBook,
  config: MapConfig,
  outcome: GameOutcome,
): { book: RecordBook; improvements: RecordImprovements; record: GameRecord } {
  const now = outcome.now ?? Date.now();
  const signature = configSignature(config);
  const previous = book[signature] ?? emptyRecord(config, now);

  const improvements: RecordImprovements = { ...NO_IMPROVEMENTS };
  const record: GameRecord = {
    ...previous,
    signature,
    difficultyCoefficient: difficultyCoefficient(config),
    updatedAt: now,
  };

  if (!outcome.won) {
    record.losses = previous.losses + 1;
    return { book: { ...book, [signature]: record }, improvements, record };
  }

  record.wins = previous.wins + 1;
  improvements.firstWin = previous.wins === 0;

  if (previous.bestTimeMs === null || outcome.elapsedMs < previous.bestTimeMs) {
    record.bestTimeMs = outcome.elapsedMs;
    improvements.time = true;
  }
  if (previous.bestEfficiency === null || outcome.routeEfficiency > previous.bestEfficiency) {
    record.bestEfficiency = outcome.routeEfficiency;
    improvements.efficiency = true;
  }
  if (previous.bestMoves === null || outcome.moves < previous.bestMoves) {
    record.bestMoves = outcome.moves;
    improvements.moves = true;
  }

  return { book: { ...book, [signature]: record }, improvements, record };
}

export function hasAnyImprovement(improvements: RecordImprovements): boolean {
  return improvements.time || improvements.efficiency || improvements.moves;
}
