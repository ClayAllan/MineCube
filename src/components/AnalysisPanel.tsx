import type { Dispatch } from 'react';
import type { AnalysisResult } from '../game/analysis';
import type { GameAction } from '../game/gameReducer';
import { indexToPosition } from '../game/neighbors';
import { bestMove, riskLevel, type DirectionRisk } from '../game/risk';
import type { AnalysisState, Dims } from '../game/types';
import { formatPosition } from '../utils/format';

export interface AnalysisPanelProps {
  dims: Dims;
  analysis: AnalysisState;
  result: AnalysisResult;
  risks: DirectionRisk[];
  dispatch: Dispatch<GameAction>;
}

/** 六方向风险速览：玩家每一步真正要做的决策 */
function MoveRisks({ risks }: { risks: DirectionRisk[] }) {
  const best = bestMove(risks);
  const passable = risks.filter((entry) => entry.risk.passable);

  return (
    <>
      <h4 className="panel__subtitle">下一步风险</h4>
      <ul className="risk-list">
        {risks.map((entry) => {
          const level = riskLevel(entry.risk);
          const isBest = best?.direction.id === entry.direction.id;
          return (
            <li
              key={entry.direction.id}
              className={`risk-list__item risk-list__item--${level}${isBest ? ' risk-list__item--best' : ''}`}
            >
              <span className="risk-list__key">{entry.direction.key}</span>
              <span className="risk-list__label">{entry.direction.label}</span>
              <span className="risk-list__value">
                {entry.risk.kind === 'safe'
                  ? '✓ 安全'
                  : entry.risk.kind === 'mine'
                    ? '✗ 有雷'
                    : entry.risk.label}
              </span>
            </li>
          );
        })}
      </ul>
      {passable.length === 0 ? (
        <p className="notice notice--warn">六个方向全部不可通行，需要先取消旗帜或换条路。</p>
      ) : best ? (
        <p className={`notice ${best.risk.kind === 'safe' ? 'notice--good' : ''}`}>
          推荐：向<strong>{best.direction.label}</strong>（{best.direction.key}）
          {best.risk.kind === 'safe'
            ? ' —— 可以确定是安全格'
            : best.risk.kind === 'known-safe'
              ? ' —— 已探索过的安全格'
              : best.risk.kind === 'unknown'
                ? ' —— 目前没有任何信息'
                : ` —— 含雷概率约 ${best.risk.label}`}
        </p>
      ) : null}
    </>
  );
}

function positionList(dims: Dims, indices: number[], limit = 6): string {
  const shown = indices
    .slice(0, limit)
    .map((index) => formatPosition(indexToPosition(dims, index)))
    .join('、');
  return indices.length > limit ? `${shown} …` : shown;
}

/**
 * 推理分析面板。
 *
 * 推理默认使用**全部已探索格**作为约束；手选线索只是一个「聚焦看这几格」的透镜，
 * 用来看它们邻域的重叠区域。工具只整理信息，不会替玩家走棋。
 */
export function AnalysisPanel({ dims, analysis, result, risks, dispatch }: AnalysisPanelProps) {
  const { enabled, clues, onlyOverlap } = analysis;
  const hasFocus = result.clues.length > 0;
  const hasFindings = result.definiteMines.length > 0 || result.definiteSafe.length > 0;

  return (
    <div className="panel">
      <h3 className="panel__title">推理分析</h3>

      <label className="switch">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatch({ type: 'SET_ANALYSIS', value: e.target.checked })}
        />
        <span>开启分析模式</span>
      </label>

      {!enabled ? (
        <p className="panel__note">
          开启后会用你已探索的**全部**数字格、旗帜和地雷总数一起推理，标出可以确定的雷与安全格，
          并给出其余格子的含雷概率。它只整理你已有的信息，不会替你走棋。
        </p>
      ) : (
        <>
          <MoveRisks risks={risks} />

          <h4 className="panel__subtitle">全局推理</h4>
          <dl className="stat-list">
            <div className="stat-list__item">
              <dt>参与推理的约束</dt>
              <dd className="mono">{result.constraintCount} 条</dd>
            </div>
            <div className="stat-list__item">
              <dt>剩余未知格</dt>
              <dd className="mono">{result.unknownCount}</dd>
            </div>
            <div className="stat-list__item">
              <dt>还没找到的雷</dt>
              <dd className="mono">{result.remainingMines}</dd>
            </div>
            <div className="stat-list__item">
              <dt>确定有雷</dt>
              <dd className="mono verdict-mine">{result.definiteMines.length}</dd>
            </div>
            <div className="stat-list__item">
              <dt>确定安全</dt>
              <dd className="mono verdict-safe">{result.definiteSafe.length}</dd>
            </div>
          </dl>

          {result.definiteMines.length > 0 ? (
            <p className="notice notice--danger">
              确定有雷：{positionList(dims, result.definiteMines)}
            </p>
          ) : null}

          {result.definiteSafe.length > 0 ? (
            <p className="notice notice--good">
              确定安全：{positionList(dims, result.definiteSafe)}
            </p>
          ) : null}

          {!hasFindings ? (
            <p className="notice">
              目前没有可以百分之百确定的格子，只能参考概率。三维里 26 邻域很粗，
              开启「六邻域雷数」会让确定结论多很多。
            </p>
          ) : null}

          {result.contradictions.map((message) => (
            <p key={message} className="notice notice--warn">
              {message}
            </p>
          ))}

          {!result.exact ? (
            <p className="notice notice--warn">
              局面过于复杂，部分区域的概率是估计值而不是精确计算。
            </p>
          ) : null}

          <h4 className="panel__subtitle">聚焦线索（可选）</h4>
          <p className="panel__note">
            点击已探索的数字格可以把它加入聚焦，用来单独查看这几格邻域的<strong>重叠区域</strong>。
            聚焦不影响推理范围。当前已选 <strong>{clues.length}</strong> 个。
          </p>

          {hasFocus ? (
            <>
              <dl className="stat-list">
                <div className="stat-list__item">
                  <dt>重叠区域</dt>
                  <dd className="mono">{result.intersection.length} 格</dd>
                </div>
                <div className="stat-list__item">
                  <dt>覆盖范围</dt>
                  <dd className="mono">{result.union.length} 格</dd>
                </div>
              </dl>

              <ul className="clue-list">
                {result.clues.map((clue) => (
                  <li key={clue.index} className="clue-list__item">
                    <span className="mono">{formatPosition(clue.position)}</span>
                    <span className="clue-list__meta">
                      数字 {clue.number} · 已标记 {clue.assumedMines} · 还剩{' '}
                      <strong>{clue.remaining}</strong> / {clue.unknown.length} 未知
                    </span>
                    <button
                      type="button"
                      className="clue-list__remove"
                      title="移出聚焦"
                      onClick={() => dispatch({ type: 'TOGGLE_CLUE', position: clue.position })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={onlyOverlap}
                  onChange={(e) => dispatch({ type: 'SET_ONLY_OVERLAP', value: e.target.checked })}
                />
                <span>只显示聚焦线索与重叠区域</span>
              </label>

              <button
                type="button"
                className="btn btn--sm btn--block"
                onClick={() => dispatch({ type: 'CLEAR_CLUES' })}
              >
                清空聚焦
              </button>
            </>
          ) : null}

          <p className="panel__note">
            绿色 ✓ 和红色 ✗ 是可以确定的结论；百分比是含雷概率，
            在能枚举的范围内是精确值，否则是估计。推理会把你插的旗帜当成雷，旗帜插错结论就会错。
          </p>
        </>
      )}
    </div>
  );
}
