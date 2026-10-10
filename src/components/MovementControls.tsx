import type { Dispatch } from 'react';
import { DIRECTIONS } from '../game/constants';
import type { GameAction } from '../game/gameReducer';
import { addDelta, inBounds } from '../game/neighbors';
import { riskLevel, type DirectionRisk } from '../game/risk';
import type { DirectionId, GameMap, Position } from '../game/types';

export interface MovementControlsProps {
  map: GameMap;
  player: Position;
  selected: Position | null;
  disabled: boolean;
  /** 六方向风险，顺序与 DIRECTIONS 一致；分析模式关闭时全部是 unknown */
  risks: DirectionRisk[];
  /** 相机相对移动开启时，按键对应的实际世界方向 */
  effectiveDirections: Partial<Record<DirectionId, DirectionId>>;
  dispatch: Dispatch<GameAction>;
}

/** 屏幕上的六方向按钮，不使用键盘也能完整游玩 */
export function MovementControls({
  map,
  player,
  selected,
  disabled,
  risks,
  effectiveDirections,
  dispatch,
}: MovementControlsProps) {
  // 有任何一个按键指向了不同的世界方向，说明相机相对移动正在生效
  const relative = DIRECTIONS.some(
    (d) => (effectiveDirections[d.id] ?? d.id) !== d.id,
  );
  const byId = (id: DirectionId) => DIRECTIONS.find((d) => d.id === id)!;
  const riskById = (id: DirectionId) => risks.find((r) => r.direction.id === id)?.risk;

  const renderButton = (keyId: DirectionId, className: string) => {
    // 按键固定，但它实际走向的世界方向可能被「相机相对移动」改写
    const worldId = effectiveDirections[keyId] ?? keyId;
    const keyDir = byId(keyId);
    const worldDir = byId(worldId);
    const target = addDelta(player, worldDir.delta);
    const outOfBounds = !inBounds(map.dims, target);
    const risk = riskById(worldId);
    const level = risk ? riskLevel(risk) : 'none';
    const blocked = risk ? !risk.passable : outOfBounds;

    return (
      <button
        type="button"
        className={`move-btn ${className} move-btn--risk-${level}${
          outOfBounds ? ' move-btn--edge' : ''
        }`}
        disabled={disabled || outOfBounds}
        onClick={() => dispatch({ type: 'MOVE', direction: worldId })}
        title={
          outOfBounds
            ? `${worldDir.label}方向已到地图边界`
            : `向${worldDir.label}移动（${keyDir.key} 键，${worldDir.axisLabel}）${
                risk && risk.kind !== 'unknown' ? ` · ${risk.label}` : ''
              }`
        }
      >
        <span className="move-btn__key">{keyDir.key}</span>
        <span className="move-btn__label">{worldDir.label}</span>
        <span className="move-btn__axis">{worldDir.axisLabel}</span>
        {risk && risk.kind !== 'unknown' ? (
          <span className={`move-btn__risk move-btn__risk--${level}${blocked ? ' move-btn__risk--blocked' : ''}`}>
            {risk.kind === 'safe' ? '✓ 安全' : risk.kind === 'mine' ? '✗ 有雷' : risk.label}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="movement">
      <div className="movement__pad">
        <span className="movement__spacer" />
        {renderButton('forward', 'move-btn--forward')}
        {renderButton('up', 'move-btn--up')}

        {renderButton('left', 'move-btn--left')}
        <button
          type="button"
          className="move-btn move-btn--flag"
          disabled={disabled || !selected}
          onClick={() => selected && dispatch({ type: 'TOGGLE_FLAG', position: selected })}
          title="循环切换选中格的标记：无 → 旗 → 问号 → 无（F 键 / 右键点击格子）"
        >
          <span className="move-btn__key">F</span>
          <span className="move-btn__label">标记</span>
          <span className="move-btn__axis">选中格</span>
        </button>
        {renderButton('right', 'move-btn--right')}

        <span className="movement__spacer" />
        {renderButton('back', 'move-btn--back')}
        {renderButton('down', 'move-btn--down')}
      </div>

      <div className="movement__hints">
        {relative ? (
          <p>
            <strong>相机相对移动已开启</strong>：W 表示「远离相机」，按钮上显示的是它当前实际走的世界方向。
            Q/E 始终是世界上下。
          </p>
        ) : (
          <p>
            <strong>坐标轴</strong>：X 左右 · Y 上下 · Z 前后（W 为 Z 减小方向）
          </p>
        )}
        <p>
          鼠标拖动旋转视角，滚轮缩放；左键选中格子，<strong>同一位置连续点击可依次向内切换</strong>，
          右键给选中格插旗。
        </p>
        <p>
          <strong>Shift + 方向键</strong>移动选中格光标（可穿到地图内部），
          <strong>F</strong> 循环标记（无 → 旗 → 问号 → 无），<strong>G</strong> 光标回到玩家。
          只有旗帜会挡路，问号不挡。
        </p>
      </div>
    </div>
  );
}
