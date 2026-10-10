import type { Dispatch } from 'react';
import { MAX_FOCUS_RADIUS } from '../game/constants';
import { axisLength, type GameAction } from '../game/gameReducer';
import type { Dims, Position, SliceAxis, SliceState } from '../game/types';

const AXIS_OPTIONS: { id: SliceAxis; label: string; hint: string }[] = [
  { id: 'none', label: '全部显示', hint: '完整立方体' },
  { id: 'x', label: 'X 轴切片', hint: '左右方向分层' },
  { id: 'y', label: 'Y 轴切片', hint: '上下方向分层' },
  { id: 'z', label: 'Z 轴切片', hint: '前后方向分层' },
];

export interface LayerControlsProps {
  dims: Dims;
  slice: SliceState;
  player: Position;
  dispatch: Dispatch<GameAction>;
}

/**
 * 切片查看面板。
 * 完整立方体会互相遮挡，分层查看是核心功能：选定某个轴后只突出显示一层，
 * 其余层降到极低透明度作为空间参考。
 */
export function LayerControls({ dims, slice, player, dispatch }: LayerControlsProps) {
  const playerLayer = slice.axis === 'x' ? player.x : slice.axis === 'y' ? player.y : player.z;
  const playerInLayer = slice.axis === 'none' || playerLayer === slice.level;
  // 每个轴的层数可能不同，滑块上限要按当前轴取
  const layerCount = axisLength(dims, slice.axis);

  return (
    <div className="panel">
      <h3 className="panel__title">切片查看</h3>

      <div className="axis-buttons">
        {AXIS_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`chip${slice.axis === option.id ? ' chip--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SLICE_AXIS', axis: option.id })}
            aria-pressed={slice.axis === option.id}
            title={option.hint}
          >
            {option.label}
          </button>
        ))}
      </div>

      {slice.axis !== 'none' ? (
        <div className="slice-slider">
          <label className="field__label" htmlFor="slice-level">
            当前层级
            <span className="field__value">
              {slice.axis.toUpperCase()} = {slice.level}（0 ~ {layerCount - 1}）
            </span>
          </label>
          <input
            id="slice-level"
            type="range"
            min={0}
            max={layerCount - 1}
            step={1}
            value={Math.min(slice.level, layerCount - 1)}
            onChange={(e) => dispatch({ type: 'SET_SLICE_LEVEL', level: Number(e.target.value) })}
          />
          {!playerInLayer ? (
            <p className="notice notice--warn">
              玩家当前在 {slice.axis.toUpperCase()} = {playerLayer} 层，不在这一层。
            </p>
          ) : (
            <p className="notice">玩家就在这一层。</p>
          )}
          <button
            type="button"
            className="btn btn--sm btn--block"
            onClick={() => dispatch({ type: 'JUMP_TO_PLAYER_LAYER' })}
          >
            跳转到玩家所在层
          </button>
        </div>
      ) : null}

      <div className="focus-radius">
        <label className="field__label" htmlFor="focus-radius">
          聚焦半径
          <span className="field__value">
            {slice.focusRadius === 0
              ? '不限制'
              : `${slice.focusRadius * 2 + 1}×${slice.focusRadius * 2 + 1}×${slice.focusRadius * 2 + 1}`}
          </span>
        </label>
        <input
          id="focus-radius"
          type="range"
          min={0}
          max={MAX_FOCUS_RADIUS}
          step={1}
          value={slice.focusRadius}
          onChange={(e) => dispatch({ type: 'SET_FOCUS_RADIUS', value: Number(e.target.value) })}
        />
        <p className="panel__note">
          只显示以玩家为中心的这一小块，其余格子完全隐藏。起点和终点会保留下来作为导航锚点。
        </p>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={slice.onlyExplored}
          onChange={(e) => dispatch({ type: 'SET_ONLY_EXPLORED', value: e.target.checked })}
        />
        <span>只显示已探索区域</span>
      </label>

      <div className="panel__actions">
        <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RESET_VIEW' })}>
          恢复完整立方体
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => dispatch({ type: 'FOCUS_PLAYER' })}
        >
          聚焦玩家
        </button>
      </div>
    </div>
  );
}
