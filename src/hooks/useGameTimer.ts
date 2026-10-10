import { useEffect } from 'react';
import type { Dispatch } from 'react';
import type { GameAction } from '../game/gameReducer';
import type { GameStatus } from '../game/types';

/**
 * 计时器。真正的时间来源是 state 中的时间戳，这里只负责按固定间隔触发 TICK，
 * 因此不会因为 React 闭包问题导致计时漂移或停摆。
 */
export function useGameTimer(status: GameStatus, dispatch: Dispatch<GameAction>): void {
  useEffect(() => {
    if (status !== 'playing') return;
    const id = window.setInterval(() => {
      dispatch({ type: 'TICK', now: Date.now() });
    }, 200);
    return () => window.clearInterval(id);
  }, [status, dispatch]);
}
