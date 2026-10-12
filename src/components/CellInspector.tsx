import type { Dispatch } from 'react';
import { isClueCandidate } from '../game/analysis';
import { DIRECTIONS } from '../game/constants';
import type { GameAction } from '../game/gameReducer';
import { manhattan, samePosition } from '../game/neighbors';
import type { Cell, DirectionId, GameState } from '../game/types';
import { formatPosition } from '../utils/format';

export interface CellInspectorProps {
  state: GameState;
  cell: Cell | null;
  /** 终点位置此刻是否可见（结算后无条件可见） */
  revealEnd: boolean;
  dispatch: Dispatch<GameAction>;
}

function describe(cell: Cell, state: GameState, revealEnd: boolean): { title: string; detail: string } {
  const isPlayer = samePosition(cell.position, state.player);
  if (isPlayer) {
    return { title: '玩家所在格', detail: `周围 26 邻域共有 ${cell.adjacentMineCount} 颗地雷` };
  }
  if (cell.revealedMine) {
    return { title: '已揭示地雷', detail: '不可通行的永久障碍' };
  }
  if (cell.type === 'rock') {
    return { title: '实心岩块', detail: '不是地雷，也不计入任何数字，但永远挡路' };
  }
  if (state.map && samePosition(cell.position, state.map.start)) {
    return {
      title: '起点',
      detail: `本局出发位置，周围 26 邻域共有 ${cell.adjacentMineCount} 颗地雷`,
    };
  }
  // 终点被藏起来时不能在这里泄露它的身份
  if (
    state.map &&
    samePosition(cell.position, state.map.end) &&
    (revealEnd || cell.explored)
  ) {
    return { title: '终点', detail: '进入此格即获得胜利' };
  }
  if (cell.mark === 'flag') {
    return { title: '已插旗', detail: '你断言这里有雷；必须先取消旗帜才能进入' };
  }
  if (cell.mark === 'unsure') {
    return { title: '已标问号', detail: '你拿不准这里有没有雷；问号不计入剩余雷数，也不阻挡移动' };
  }
  if (cell.explored) {
    return { title: '已探索安全格', detail: `周围 26 邻域共有 ${cell.adjacentMineCount} 颗地雷` };
  }
  return { title: '未探索', detail: '信息未知，进入后才会显示数字' };
}

/** 光标方向盘：不依赖鼠标拾取，可以把选中格移动到立方体内部任意位置 */
function CursorPad({ dispatch }: { dispatch: Dispatch<GameAction> }) {
  const byId = (id: DirectionId) => DIRECTIONS.find((d) => d.id === id)!;
  const key = (id: DirectionId) => {
    const dir = byId(id);
    return (
      <button
        type="button"
        className="cursor-pad__btn"
        onClick={() => dispatch({ type: 'MOVE_CURSOR', direction: id })}
        title={`把选中格向${dir.label}移动一格（Shift + ${dir.key}）`}
      >
        {dir.label}
      </button>
    );
  };

  return (
    <div className="cursor-pad">
      <div className="cursor-pad__grid">
        <span />
        {key('forward')}
        {key('up')}
        {key('left')}
        <button
          type="button"
          className="cursor-pad__btn cursor-pad__btn--home"
          onClick={() => dispatch({ type: 'CURSOR_TO_PLAYER' })}
          title="把选中格移回玩家所在位置（G 键）"
        >
          回位
        </button>
        {key('right')}
        <span />
        {key('back')}
        {key('down')}
      </div>
      <p className="panel__note">
        用 <kbd>Shift</kbd> + <kbd>W</kbd>/<kbd>A</kbd>/<kbd>S</kbd>/<kbd>D</kbd>/<kbd>Q</kbd>/
        <kbd>E</kbd> 也能移动选中格，它可以穿到地图内部；<kbd>F</kbd> 循环切换标记（无 → 旗 → 问号）。
      </p>
    </div>
  );
}

/** 右侧「当前选中格信息」面板 */
export function CellInspector({ state, cell, revealEnd, dispatch }: CellInspectorProps) {
  if (!state.map) return null;

  if (!cell) {
    return (
      <div className="panel">
        <h3 className="panel__title">选中格信息</h3>
        <p className="panel__note">
          在 3D 视图中点击任意格子查看坐标与状态；被外层挡住的格子，在同一位置连续点击即可依次向内切换。
        </p>
        <CursorPad dispatch={dispatch} />
      </div>
    );
  }

  const info = describe(cell, state, revealEnd);
  const distance = manhattan(cell.position, state.player);
  const numbersVisible = cell.explored || samePosition(cell.position, state.player);
  const isClue = state.analysis.clues.some((p) => samePosition(p, cell.position));
  // 与 reducer 中的规则保持一致：终点被藏起来时它就是普通未探索格，可以插旗
  const endIsHidden = !revealEnd && !cell.explored;
  const canFlag =
    state.status === 'playing' &&
    !cell.explored &&
    !cell.revealedMine &&
    cell.type !== 'rock' &&
    (cell.type !== 'end' || endIsHidden) &&
    cell.type !== 'start';

  return (
    <div className="panel">
      <h3 className="panel__title">选中格信息</h3>
      <dl className="stat-list">
        <div className="stat-list__item">
          <dt>坐标</dt>
          <dd className="mono">{formatPosition(cell.position)}</dd>
        </div>
        <div className="stat-list__item">
          <dt>状态</dt>
          <dd>{info.title}</dd>
        </div>
        <div className="stat-list__item">
          <dt>与玩家距离</dt>
          <dd>{distance} 步（曼哈顿）</dd>
        </div>
        {numbersVisible ? (
          <div className="stat-list__item">
            <dt>26 邻域雷数</dt>
            <dd className="mono">{cell.adjacentMineCount}</dd>
          </div>
        ) : null}
        {numbersVisible && state.config.difficulty.showOrthogonalCount ? (
          <div className="stat-list__item">
            <dt>六邻域雷数</dt>
            <dd className="mono">{cell.orthogonalMineCount}</dd>
          </div>
        ) : null}
      </dl>
      <p className="panel__note">{info.detail}</p>
      <button
        type="button"
        className="btn btn--sm btn--block"
        disabled={!canFlag}
        onClick={() => dispatch({ type: 'TOGGLE_FLAG', position: cell.position })}
      >
        {cell.mark === 'none' ? '插旗（F）' : cell.mark === 'flag' ? '改为问号（F）' : '清除标记（F）'}
      </button>
      {state.analysis.enabled && isClueCandidate(cell, state.player) ? (
        <button
          type="button"
          className="btn btn--sm btn--block"
          onClick={() => dispatch({ type: 'TOGGLE_CLUE', position: cell.position })}
        >
          {isClue ? '移出分析线索' : '加入分析线索'}
        </button>
      ) : null}
      {distance === 1 && state.status === 'playing' ? (
        <p className="panel__note panel__note--accent">该格与玩家相邻，可以直接尝试移动进入。</p>
      ) : null}
      <CursorPad dispatch={dispatch} />
    </div>
  );
}
