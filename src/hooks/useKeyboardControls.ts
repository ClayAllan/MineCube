import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { DirectionMap } from '../game/cameraRelative';
import { DIRECTION_BY_KEY } from '../game/constants';
import type { GameAction } from '../game/gameReducer';
import type { Position } from '../game/types';

/** 连续按键的最小间隔（毫秒），避免长按时移动过快 */
const MOVE_THROTTLE_MS = 110;

export interface KeyboardOptions {
  enabled: boolean;
  selected: Position | null;
  /** 按键 -> 实际世界方向的映射（相机相对移动开启时不是恒等映射） */
  directionMap: DirectionMap;
  /** 第一人称下用方向键整格转向（弧度，正数向左） */
  onTurn?: (delta: number) => void;
  onTogglePause: () => void;
}

/**
 * 键盘操作：
 * W/S 前后（Z 轴）、A/D 左右（X 轴）、Q/E 上下（Y 轴）、F 给选中格插旗、空格或 P 暂停。
 */
export function useKeyboardControls(
  dispatch: Dispatch<GameAction>,
  options: KeyboardOptions,
): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const lastMoveRef = useRef(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 输入框内不劫持按键
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toUpperCase();
      const current = optionsRef.current;

      // 第一人称转向：方向键左右各转 90°
      if (current.onTurn && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        current.onTurn(event.key === 'ArrowLeft' ? Math.PI / 2 : -Math.PI / 2);
        return;
      }

      if (key === ' ' || key === 'P' || key === 'SPACEBAR') {
        event.preventDefault();
        current.onTogglePause();
        return;
      }

      if (!current.enabled) return;

      if (key === 'F') {
        event.preventDefault();
        if (current.selected) dispatch({ type: 'TOGGLE_FLAG', position: current.selected });
        return;
      }

      if (key === 'G') {
        event.preventDefault();
        dispatch({ type: 'CURSOR_TO_PLAYER' });
        return;
      }

      const ARROW_MAP: Record<string, string> = {
        ARROWUP: 'W',
        ARROWDOWN: 'S',
        ARROWLEFT: 'A',
        ARROWRIGHT: 'D',
      };
      const direction = DIRECTION_BY_KEY[ARROW_MAP[key] ?? key];
      if (!direction) return;

      event.preventDefault();

      // 按键可能被「相机相对移动」重新映射到别的世界方向
      const worldDirection = current.directionMap[direction.id] ?? direction.id;

      // Shift + 方向键移动的是「选中格光标」而不是玩家本人。
      // 光标能穿到地图内部，因此内部格也可以被选中并插旗。
      if (event.shiftKey) {
        dispatch({ type: 'MOVE_CURSOR', direction: worldDirection });
        return;
      }

      // 重复按键与快速连按都做节流，保证状态更新可控
      const now = Date.now();
      if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
      lastMoveRef.current = now;
      dispatch({ type: 'MOVE', direction: worldDirection });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);
}
