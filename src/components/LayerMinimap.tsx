import { memo, useState } from 'react';
import { DIRECTIONS } from '../game/constants';
import { manhattan, positionToIndex } from '../game/neighbors';
import type { DirectionId, GameMap, Position, SliceState } from '../game/types';

export interface LayerMinimapProps {
  map: GameMap;
  player: Position;
  selected: Position | null;
  slice: SliceState;
  revealEnd: boolean;
  onMove: (direction: DirectionId) => void;
  onSelect: (position: Position) => void;
  onFlag: (position: Position) => void;
}

function numberColor(n: number): string {
  switch (n) {
    case 1:
      return '#38bdf8';
    case 2:
      return '#4ade80';
    case 3:
      return '#f87171';
    case 4:
      return '#c084fc';
    case 5:
      return '#fb923c';
    case 6:
      return '#2dd4bf';
    case 7:
      return '#f43f5e';
    case 8:
      return '#e879f9';
    default:
      return '#94a3b8';
  }
}

function LayerMinimapImpl({
  map,
  player,
  selected,
  slice,
  revealEnd,
  onMove,
  onSelect,
  onFlag,
}: LayerMinimapProps) {
  // 当前查看的高度层，默认始终跟随玩家的 Y 层
  const [viewY, setViewY] = useState<number>(player.y);

  // 如果玩家移动到了新的高度层，自动同步
  const currentY = Math.max(0, Math.min(map.dims.y - 1, viewY));

  const isPlayerLayer = player.y === currentY;

  const handleCellClick = (pos: Position, e: React.MouseEvent) => {
    e.stopPropagation();
    // 如果是相邻格且未按 Shift，直接迈步进入
    if (!e.shiftKey && manhattan(player, pos) === 1) {
      const dir = DIRECTIONS.find(
        (d) =>
          d.delta.x === pos.x - player.x &&
          d.delta.y === pos.y - player.y &&
          d.delta.z === pos.z - player.z,
      );
      if (dir) {
        onMove(dir.id);
        onSelect(pos);
        return;
      }
    }
    onSelect(pos);
  };

  const handleCellContextMenu = (pos: Position, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFlag(pos);
  };

  return (
    <div className="panel minimap-panel" style={{ padding: '12px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
          平面雷达 (Y = {currentY})
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className="btn btn--sm"
            style={{ padding: '2px 6px', fontSize: '11px', height: '22px' }}
            disabled={currentY >= map.dims.y - 1}
            onClick={() => setViewY((y) => Math.min(map.dims.y - 1, y + 1))}
            title="查看上一层 (高处)"
          >
            ↑ 上层
          </button>
          <button
            type="button"
            className="btn btn--sm"
            style={{ padding: '2px 6px', fontSize: '11px', height: '22px' }}
            disabled={currentY <= 0}
            onClick={() => setViewY((y) => Math.max(0, y - 1))}
            title="查看下一层 (低处)"
          >
            ↓ 下层
          </button>
          {!isPlayerLayer ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              style={{ padding: '2px 6px', fontSize: '11px', height: '22px' }}
              onClick={() => setViewY(player.y)}
              title="回到玩家当前所在的高度层"
            >
              回玩家层
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          fontSize: '11px',
          color: '#64748b',
          marginBottom: '8px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>↑ W(前) · ↓ S(后)</span>
        <span>← A(左) · → D(右)</span>
      </div>

      {/* 2D 网格：行代表 Z（由小到大，上到下），列代表 X（由小到大，左到右） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${map.dims.x}, minmax(0, 1fr))`,
          gap: '3px',
          background: 'rgba(15, 23, 42, 0.7)',
          padding: '6px',
          borderRadius: '8px',
          border: '1px solid rgba(51, 65, 85, 0.5)',
        }}
      >
        {Array.from({ length: map.dims.z }).map((_, z) =>
          Array.from({ length: map.dims.x }).map((__, x) => {
            const pos: Position = { x, y: currentY, z };
            const idx = positionToIndex(map.dims, pos);
            const cell = map.cells[idx]!;
            const isPlayer = player.x === x && player.y === currentY && player.z === z;
            const isSelected = selected && selected.x === x && selected.y === currentY && selected.z === z;
            const isNeighbor = isPlayerLayer && manhattan(player, pos) === 1;

            let bgColor = 'rgba(30, 41, 59, 0.8)';
            let content: React.ReactNode = null;

            if (isPlayer) {
              bgColor = '#0891b2';
              content = <span style={{ color: '#fff', fontWeight: 900, fontSize: '13px' }}>◆</span>;
            } else if (cell.mark === 'flag') {
              bgColor = 'rgba(147, 51, 234, 0.35)';
              content = <span style={{ color: '#c084fc', fontSize: '11px' }}>🚩</span>;
            } else if (cell.mark === 'unsure') {
              content = <span style={{ color: '#cbd5e1', fontSize: '11px' }}>?</span>;
            } else if (cell.revealedMine) {
              bgColor = 'rgba(239, 68, 68, 0.4)';
              content = <span style={{ color: '#f87171', fontSize: '11px' }}>💣</span>;
            } else if (cell.type === 'rock') {
              bgColor = 'rgba(71, 85, 105, 0.6)';
              content = <span style={{ color: '#94a3b8', fontSize: '10px' }}>■</span>;
            } else if (cell.explored) {
              bgColor = 'rgba(15, 23, 42, 0.95)';
              if (cell.type === 'start') {
                content = <span style={{ color: '#4ade80', fontWeight: 800, fontSize: '11px' }}>S</span>;
              } else if (cell.type === 'end' && (revealEnd || cell.explored)) {
                content = <span style={{ color: '#facc15', fontWeight: 800, fontSize: '11px' }}>★</span>;
              } else if (cell.adjacentMineCount > 0) {
                content = (
                  <span
                    style={{
                      color: numberColor(cell.adjacentMineCount),
                      fontWeight: 800,
                      fontSize: '11px',
                    }}
                  >
                    {cell.adjacentMineCount}
                  </span>
                );
              }
            } else if (cell.type === 'end' && revealEnd) {
              content = <span style={{ color: '#facc15', fontWeight: 800, fontSize: '11px' }}>★</span>;
            }

            return (
              <div
                key={`${x}-${z}`}
                onClick={(e) => handleCellClick(pos, e)}
                onContextMenu={(e) => handleCellContextMenu(pos, e)}
                style={{
                  aspectRatio: '1 / 1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: bgColor,
                  borderRadius: '3px',
                  cursor: 'pointer',
                  border: isSelected
                    ? '2px solid #facc15'
                    : isNeighbor
                      ? '1px dashed #38bdf8'
                      : '1px solid rgba(51, 65, 85, 0.4)',
                  boxShadow: isPlayer ? '0 0 8px #22d3ee' : 'none',
                  transition: 'all 0.12s ease',
                  userSelect: 'none',
                }}
                title={`(${x}, ${currentY}, ${z}) · 点击移动/选中，右键插旗`}
              >
                {content}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export const LayerMinimap = memo(LayerMinimapImpl);
