import { motion } from 'framer-motion';
import type { Cell, GameState } from '../game/types';
import { formatDims, totalCells } from '../game/constants';
import { manhattan } from '../game/neighbors';
import { countFlags, countRevealedMines } from '../game/selectors';
import { formatDuration, formatPosition } from '../utils/format';

export interface GameHUDProps {
  state: GameState;
  playerCell: Cell | null;
}

function Hearts({ lives, initial }: { lives: number; initial: number }) {
  return (
    <span className="hearts" aria-label={`剩余生命 ${lives} / ${initial}`}>
      {Array.from({ length: initial }, (_, i) => (
        <span key={i} className={`heart${i < lives ? '' : ' heart--lost'}`} aria-hidden="true">
          {i < lives ? '♥' : '♡'}
        </span>
      ))}
    </span>
  );
}

export function GameHUD({ state, playerCell }: GameHUDProps) {
  const { map } = state;
  if (!map) return null;

  const flags = countFlags(map.cells);
  const unsure = map.cells.filter((c) => c.mark === 'unsure').length;
  const revealed = countRevealedMines(map.cells);
  // 插旗与已揭示的雷都算「已经找到」，剩余数量随之减少（标准扫雷计数）
  const remainingMines = map.mineCount - flags - revealed;
  const explored = map.cells.filter((c) => c.explored).length;
  const total = totalCells(map.dims);

  return (
    <motion.div 
      className="hud"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="hud__block hud__block--lives">
        <span className="hud__label">生命</span>
        <div className="hud__value hud__value--lives">
          <Hearts lives={state.lives} initial={state.initialLives} />
          <span className="hud__lives-count">
            {state.lives} / {state.initialLives}
          </span>
        </div>
      </div>

      <div className="hud__row">
        <div className="hud__block">
          <span className="hud__label">时间</span>
          <span className="hud__value hud__value--mono">{formatDuration(state.elapsedMs)}</span>
        </div>
        <div className="hud__block">
          <span className="hud__label">步数</span>
          <span className="hud__value hud__value--mono">{state.moves}</span>
        </div>
      </div>

      <div className="hud__block">
        <span className="hud__label">当前坐标</span>
        <span className="hud__value hud__value--mono">{formatPosition(state.player)}</span>
        <span className="hud__hint">格式为 (X左右, Y上下, Z前后)</span>
      </div>

      {!state.config.difficulty.showEndPosition ? (
        <div className="hud__block hud__block--number">
          <span className="hud__label">距终点</span>
          <span className="hud__big-number">{manhattan(state.player, map.end)}</span>
          <span className="hud__hint">终点位置已隐藏，只提供曼哈顿距离作为方向提示</span>
        </div>
      ) : null}

      <div className="hud__block hud__block--number">
        <span className="hud__label">当前格周围地雷数</span>
        <span className="hud__big-number">{playerCell ? playerCell.adjacentMineCount : '—'}</span>
        <span className="hud__hint">统计以当前格为中心 3×3×3 内最多 26 个邻格</span>
      </div>

      <dl className="stat-list">
        <div className="stat-list__item">
          <dt>踩雷次数</dt>
          <dd>{state.mineHits}</dd>
        </div>
        <div className="stat-list__item">
          <dt>已插旗数量</dt>
          <dd>{flags}</dd>
        </div>
        {unsure > 0 ? (
          <div className="stat-list__item">
            <dt>已标问号</dt>
            <dd>{unsure}</dd>
          </div>
        ) : null}
        <div className="stat-list__item">
          <dt>已揭示地雷</dt>
          <dd>
            {revealed} / {map.mineCount}
          </dd>
        </div>
        <div className="stat-list__item stat-list__item--strong">
          <dt>剩余地雷数</dt>
          <dd className={remainingMines < 0 ? 'verdict-mine' : undefined}>{remainingMines}</dd>
        </div>
        <div className="stat-list__item">
          <dt>已探索格数</dt>
          <dd>
            {explored} / {total}
          </dd>
        </div>
        <div className="stat-list__item">
          <dt>地图尺寸</dt>
          <dd>{formatDims(map.dims)}</dd>
        </div>
        <div className="stat-list__item">
          <dt>地雷总数</dt>
          <dd>{map.mineCount}</dd>
        </div>
        {map.rockCount > 0 ? (
          <div className="stat-list__item">
            <dt>岩块数量</dt>
            <dd>{map.rockCount}</dd>
          </div>
        ) : null}
      </dl>
    </motion.div>
  );
}
