import type { Dispatch } from 'react';
import { motion } from 'framer-motion';
import { difficultyLabel, formatDims } from '../game/constants';
import {
  hasAnyImprovement,
  type GameRecord,
  type RecordImprovements,
} from '../game/records';
import type { GameAction } from '../game/gameReducer';
import type { GameStats, GameStatus } from '../game/types';
import { formatDuration, formatPercent } from '../utils/format';

export interface EndScreenProps {
  status: Extract<GameStatus, 'won' | 'lost'>;
  stats: GameStats;
  revealAllMines: boolean;
  /** 当前配置的本地最佳记录（已经包含本局结果） */
  record: GameRecord | null;
  improvements: RecordImprovements;
  dispatch: Dispatch<GameAction>;
  onBackToSetup: () => void;
  onViewMap: () => void;
}

/** 本地最佳记录区块 */
function RecordBlock({
  record,
  improvements,
}: {
  record: GameRecord | null;
  improvements: RecordImprovements;
}) {
  if (!record) return null;
  const rows = [
    {
      label: '最佳用时',
      value: record.bestTimeMs === null ? '—' : formatDuration(record.bestTimeMs),
      fresh: improvements.time,
    },
    {
      label: '最佳路线效率',
      value: record.bestEfficiency === null ? '—' : formatPercent(record.bestEfficiency),
      fresh: improvements.efficiency,
    },
    {
      label: '最少步数',
      value: record.bestMoves === null ? '—' : `${record.bestMoves} 步`,
      fresh: improvements.moves,
    },
    { label: '战绩', value: `${record.wins} 胜 / ${record.losses} 负`, fresh: false },
  ];

  return (
    <section className="record-block">
      <h3 className="record-block__title">
        这套配置的本地记录
        {hasAnyImprovement(improvements) ? <span className="record-block__new">新纪录！</span> : null}
      </h3>
      <dl className="result-grid">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`result-grid__item${row.fresh ? ' result-grid__item--fresh' : ''}`}
          >
            <dt>{row.label}</dt>
            <dd>
              {row.value}
              {row.fresh ? ' ★' : ''}
            </dd>
          </div>
        ))}
      </dl>
      <p className="panel__note">
        记录按「尺寸 + 密度 + 岩块 + 生命 + 难度修正项」分组保存在本地，换种子不影响归类。
      </p>
    </section>
  );
}

export function EndScreen({
  status,
  stats,
  revealAllMines,
  record,
  improvements,
  dispatch,
  onBackToSetup,
  onViewMap,
}: EndScreenProps) {
  const won = status === 'won';

  const rows: { label: string; value: string }[] = [
    { label: '游戏用时', value: formatDuration(stats.elapsedMs) },
    { label: '总移动步数', value: `${stats.moves} 步` },
    { label: '踩雷次数', value: `${stats.mineHits} 次` },
    { label: '剩余生命', value: `${stats.livesLeft} / ${stats.initialLives}` },
    { label: '已探索格数量', value: `${stats.exploredCount} / ${stats.totalCells}` },
    { label: '已探索比例', value: formatPercent(stats.exploredRatio) },
    { label: '插旗数量', value: `${stats.flagCount} 面` },
    {
      label: '最短安全路径长度',
      value: stats.shortestPathLength >= 0 ? `${stats.shortestPathLength} 步` : '—',
    },
    { label: '玩家实际成功移动步数', value: `${stats.moves} 步` },
    { label: '路线效率', value: formatPercent(stats.routeEfficiency) },
    {
      label: '难度系数',
      value: `${stats.difficultyCoefficient.toFixed(2)}（${difficultyLabel(stats.difficultyCoefficient)}）`,
    },
    { label: '地图尺寸', value: formatDims(stats.dims) },
    { label: '地雷数量', value: `${stats.mineCount} 颗` },
    ...(stats.rockCount > 0
      ? [{ label: '岩块数量', value: `${stats.rockCount} 块` }]
      : []),
    { label: '随机种子', value: `${stats.seed}（哈希 ${stats.seedValue}）` },
  ];

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <motion.div 
        className={`end-card${won ? ' end-card--won' : ' end-card--lost'}`}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <div className="end-card__badge" aria-hidden="true">
          {won ? '✔' : '✖'}
        </div>
        <h2 className="end-card__title">{won ? '成功抵达终点' : '生命已耗尽'}</h2>
        <p className="end-card__subtitle">
          {won
            ? '你在三维雷区中找到了一条通往终点的安全路线。'
            : '本局结束，全部地雷已揭示，可以查看完整地图复盘。'}
        </p>

        <dl className="result-grid">
          {rows.map((row) => (
            <div key={row.label} className="result-grid__item">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        <RecordBlock record={record} improvements={improvements} />

        <label className="switch switch--center">
          <input
            type="checkbox"
            checked={revealAllMines}
            disabled={!won}
            onChange={(e) => dispatch({ type: 'SET_REVEAL_ALL', value: e.target.checked })}
          />
          <span>{won ? '显示全部地雷（复盘用）' : '失败后已自动揭示全部地雷'}</span>
        </label>

        <div className="end-card__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => dispatch({ type: 'RESTART_SAME_SEED' })}
          >
            使用相同种子重玩
          </button>
          <button type="button" className="btn" onClick={() => dispatch({ type: 'NEW_MAP' })}>
            生成新地图
          </button>
          <button type="button" className="btn" onClick={onViewMap}>
            查看完整地图
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBackToSetup}>
            返回设置
          </button>
        </div>
      </motion.div>
    </div>
  );
}
