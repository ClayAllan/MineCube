import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { motion } from 'framer-motion';
import type { GameAction } from '../game/gameReducer';
import { EMPTY_ANALYSIS, analyze, isClueCandidate } from '../game/analysis';
import {
  IDENTITY_DIRECTION_MAP,
  directionMapFromForward,
  forwardIdFromYaw,
  normalizeYaw,
  snapYaw,
  yawFromForwardId,
} from '../game/cameraRelative';
import { DIRECTIONS, formatDims } from '../game/constants';
import type { GameRecord, RecordImprovements } from '../game/records';
import { computeMoveRisks } from '../game/risk';
import { computeStats, getCell, shouldShowEnd } from '../game/selectors';
import type { DirectionId, GameState, Position } from '../game/types';
import { ErrorBoundary } from './ErrorBoundary';
import { CellInspector } from './CellInspector';
import { EndScreen } from './EndScreen';
import { GameBoard3D } from './GameBoard3D';
import { GameHUD } from './GameHUD';
import { AnalysisPanel } from './AnalysisPanel';
import { LayerControls } from './LayerControls';
import { Legend } from './Legend';
import { MovementControls } from './MovementControls';
import { useKeyboardControls } from '../hooks/useKeyboardControls';

export interface GameScreenProps {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  webglAvailable: boolean;
  record: GameRecord | null;
  improvements: RecordImprovements;
  onBackToSetup: () => void;
}

export function GameScreen({
  state,
  dispatch,
  webglAvailable,
  record,
  improvements,
  onBackToSetup,
}: GameScreenProps) {
  const { map, status } = state;
  const [showEndCard, setShowEndCard] = useState(true);
  const [shake, setShake] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [viewForward, setViewForward] = useState<DirectionId>('forward');
  // 第一人称的镜头角度（纯视图状态，不进 game state）
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const firstPerson = state.viewMode === 'first-person';

  const finished = status === 'won' || status === 'lost';

  // 每次进入结算状态时重新显示结算卡片
  useEffect(() => {
    if (finished) setShowEndCard(true);
  }, [finished, state.gameId]);

  // 踩雷时的短暂震动反馈
  useEffect(() => {
    if (!state.feedback) return;
    const { type, message } = state.feedback;
    setToast(message);
    const toastTimer = window.setTimeout(() => setToast(null), 1800);

    let shakeTimer = 0;
    if (type === 'mine' || type === 'lose') {
      setShake(true);
      shakeTimer = window.setTimeout(() => setShake(false), 420);
    }
    return () => {
      window.clearTimeout(toastTimer);
      if (shakeTimer) window.clearTimeout(shakeTimer);
    };
  }, [state.feedback]);

  // 用 ref 读取最新状态，保证回调本身保持稳定（CellCube 的 memo 依赖它）
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleSelect = useCallback(
    (position: Position | null) => {
      dispatch({ type: 'SELECT_CELL', position });
      if (!position) return;
      // 分析模式下，点击一个数字已知的格子就把它加入 / 移出线索
      const current = stateRef.current;
      if (!current.analysis.enabled) return;
      const cell = getCell(current, position);
      if (cell && isClueCandidate(cell, current.player)) {
        dispatch({ type: 'TOGGLE_CLUE', position });
      }
    },
    [dispatch],
  );
  const handleFlag = useCallback(
    (position: Position) => dispatch({ type: 'TOGGLE_FLAG', position }),
    [dispatch],
  );

  // 结算后无条件显示终点位置，便于复盘（3D 视图与选中格面板必须口径一致）
  const revealEnd = shouldShowEnd(state);
  const playerCell = getCell(state, state.player);
  const selectedCell = state.selected ? getCell(state, state.selected) : null;
  const stats = useMemo(() => computeStats(state), [state]);
  const analysisResult = useMemo(
    () =>
      map && state.analysis.enabled
        ? analyze(map, state.analysis.clues, {
            endKnown: state.config.difficulty.showEndPosition,
            useOrthogonal: state.config.difficulty.showOrthogonalCount,
            player: state.player,
          })
        : EMPTY_ANALYSIS,
    [
      map,
      state.analysis.enabled,
      state.analysis.clues,
      state.player,
      state.config.difficulty.showEndPosition,
      state.config.difficulty.showOrthogonalCount,
    ],
  );

  const directionMap = useMemo(() => {
    // 第一人称下移动必然是相对镜头的，否则 W 的含义和眼睛看到的对不上
    if (firstPerson) return directionMapFromForward(forwardIdFromYaw(yaw));
    return state.cameraRelative ? directionMapFromForward(viewForward) : IDENTITY_DIRECTION_MAP;
  }, [firstPerson, yaw, state.cameraRelative, viewForward]);

  const handleTurn = useCallback((delta: number) => {
    setYaw((current) => snapYaw(current + delta));
  }, []);

  // 切进第一人称时，把镜头对齐到当前轨道视角的朝向
  const toggleViewMode = useCallback(() => {
    if (!firstPerson) {
      setYaw(yawFromForwardId(viewForward));
      setPitch(0);
    }
    dispatch({ type: 'SET_VIEW_MODE', mode: firstPerson ? 'orbit' : 'first-person' });
  }, [dispatch, firstPerson, viewForward]);

  // 第一人称：拖动鼠标环顾四周（位移不足 2px 的点击仍然会被 R3F 当作选中）
  const handleLookDown = useCallback(
    (event: React.PointerEvent) => {
      if (!firstPerson) return;
      dragRef.current = { x: event.clientX, y: event.clientY };
    },
    [firstPerson],
  );
  const handleLookMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!firstPerson || !drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = { x: event.clientX, y: event.clientY };
      setYaw((current) => normalizeYaw(current - dx * 0.005));
      setPitch((current) => Math.max(-1.2, Math.min(1.2, current - dy * 0.005)));
    },
    [firstPerson],
  );
  const handleLookUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleTogglePause = useCallback(() => {
    dispatch({ type: stateRef.current.status === 'paused' ? 'RESUME' : 'PAUSE' });
  }, [dispatch]);

  useKeyboardControls(dispatch, {
    enabled: status === 'playing',
    selected: state.selected,
    directionMap,
    onTurn: firstPerson ? handleTurn : undefined,
    onTogglePause: handleTogglePause,
  });

  const risks = useMemo(
    () =>
      map
        ? computeMoveRisks(map, state.player, analysisResult, {
            endKnown: state.config.difficulty.showEndPosition,
          })
        : [],
    [map, state.player, analysisResult, state.config.difficulty.showEndPosition],
  );

  if (!map) return null;

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            ▣
          </span>
          <span className="topbar__title">Minecube</span>
          <span className="topbar__subtitle">3D 扫雷迷宫</span>
        </div>

        <div className="topbar__meta">
          <span className="tag">
            种子 <strong className="mono">{state.config.seed}</strong>
          </span>
          <span className="tag">
            {formatDims(map.dims)} · {map.mineCount} 雷{map.rockCount > 0 ? ` · ${map.rockCount} 岩块` : ''}
          </span>
          <span className={`tag tag--status tag--${status}`}>
            {status === 'playing'
              ? '进行中'
              : status === 'paused'
                ? '已暂停'
                : status === 'won'
                  ? '已胜利'
                  : '已失败'}
          </span>
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              dispatch({ type: status === 'paused' ? 'RESUME' : 'PAUSE' })
            }
            disabled={finished}
          >
            {status === 'paused' ? '继续' : '暂停'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => dispatch({ type: 'SET_SOUND', value: !state.soundEnabled })}
            title="开启或关闭音效"
          >
            音效：{state.soundEnabled ? '开' : '关'}
          </button>
          <button
            type="button"
            className={`btn btn--sm${state.cameraRelative ? ' btn--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_CAMERA_RELATIVE', value: !state.cameraRelative })}
            title="开启后 W 表示「远离相机」，而不是固定的 Z− 方向"
          >
            视角移动：{state.cameraRelative ? '相对' : '世界'}
          </button>
          <button
            type="button"
            className={`btn btn--sm${firstPerson ? ' btn--active' : ''}`}
            onClick={toggleViewMode}
            title="第一人称：镜头站在你所在的格子里，拖动鼠标环顾，方向键左右转身"
          >
            {firstPerson ? '第一人称' : '轨道视角'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => dispatch({ type: 'RESTART_SAME_SEED' })}
          >
            重新开始
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onBackToSetup}>
            返回设置
          </button>
        </div>
      </header>

      <main className="layout">
        <motion.aside 
          className="layout__side layout__side--left"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <GameHUD state={state} playerCell={playerCell} />
        </motion.aside>

        <section
          className={`layout__board${shake ? ' layout__board--shake' : ''}${
            firstPerson ? ' layout__board--fp' : ''
          }`}
          onPointerDown={handleLookDown}
          onPointerMove={handleLookMove}
          onPointerUp={handleLookUp}
          onPointerLeave={handleLookUp}
        >
          {webglAvailable ? (
            <ErrorBoundary title="3D 渲染出现问题">
              <GameBoard3D
                map={map}
                player={state.player}
                slice={state.slice}
                revealAllMines={state.revealAllMines}
                selected={state.selected}
                interactive={status === 'playing'}
                analysis={state.analysis}
                analysisResult={analysisResult}
                difficulty={{ ...state.config.difficulty, showEndPosition: revealEnd }}
                gameId={state.gameId}
                focusToken={state.focusToken}
                firstPerson={firstPerson}
                yaw={yaw}
                pitch={pitch}
                onViewForwardChange={setViewForward}
                onSelect={handleSelect}
                onFlag={handleFlag}
              />
            </ErrorBoundary>
          ) : (
            <div className="error-fallback">
              <h2>当前浏览器不支持 WebGL</h2>
              <p className="error-fallback__message">
                3D 棋盘无法渲染。请尝试更新浏览器、开启硬件加速，或换用支持 WebGL 的浏览器。
                游戏逻辑仍可通过左侧信息与下方按钮进行。
              </p>
            </div>
          )}

          {status === 'paused' ? (
            <div className="overlay overlay--soft">
              <div className="pause-card">
                <h2>游戏已暂停</h2>
                <p>计时已停止，此时无法移动。</p>
                <ul className="help-list" style={{ textAlign: 'left', marginBottom: '20px' }}>
                  <li><kbd>W</kbd>/<kbd>S</kbd>：向前 / 向后</li>
                  <li><kbd>A</kbd>/<kbd>D</kbd>：向左 / 向右</li>
                  <li><kbd>Q</kbd>/<kbd>E</kbd>：向下 / 向上</li>
                  <li><kbd>Shift</kbd> + 方向键：移动选中格光标</li>
                  <li><kbd>F</kbd>：插旗或取消</li>
                  <li><kbd>G</kbd>：回到玩家位置</li>
                  <li><kbd>空格</kbd>：暂停 / 继续</li>
                </ul>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => dispatch({ type: 'RESUME' })}
                >
                  继续游戏
                </button>
              </div>
            </div>
          ) : null}

          {firstPerson ? (
            <>
              <div className="crosshair" aria-hidden="true" />
              <div className="fp-compass">
                <span className="fp-compass__label">朝向</span>
                <strong>{DIRECTIONS.find((d) => d.id === forwardIdFromYaw(yaw))!.axisLabel}</strong>
                <span className="fp-compass__hint">拖动环顾 · ← → 转身 · W 前进</span>
              </div>
            </>
          ) : null}

          {toast ? <div className="toast">{toast}</div> : null}

          {finished && !showEndCard ? (
            <button
              type="button"
              className="btn btn--primary floating-btn"
              onClick={() => setShowEndCard(true)}
            >
              查看结算
            </button>
          ) : null}
        </section>

        <motion.aside 
          className="layout__side layout__side--right"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <LayerControls
            dims={map.dims}
            slice={state.slice}
            player={state.player}
            dispatch={dispatch}
          />
          {state.config.difficulty.allowAnalysis ? (
          <AnalysisPanel
            dims={map.dims}
            analysis={state.analysis}
            result={analysisResult}
            risks={risks}
            dispatch={dispatch}
          />
          ) : null}
          <Legend revealing={state.revealAllMines} />
          <CellInspector
            state={state}
            cell={selectedCell}
            revealEnd={revealEnd}
            dispatch={dispatch}
          />
        </motion.aside>
      </main>

      <footer className="bottombar">
        <MovementControls
          map={map}
          player={state.player}
          selected={state.selected}
          disabled={status !== 'playing'}
          risks={risks}
          effectiveDirections={directionMap}
          dispatch={dispatch}
        />
      </footer>

      {finished && showEndCard && stats ? (
        <EndScreen
          status={status}
          stats={stats}
          revealAllMines={state.revealAllMines}
          record={record}
          improvements={improvements}
          dispatch={dispatch}
          onBackToSetup={onBackToSetup}
          onViewMap={() => setShowEndCard(false)}
        />
      ) : null}

      <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 100 }}>
        <button 
          className="btn btn--sm" 
          onClick={() => dispatch({ type: status === 'paused' ? 'RESUME' : 'PAUSE' })}
          style={{ opacity: 0.8 }}
        >
          {status === 'paused' ? '继续游戏 (空格)' : '操作指南 (空格暂停)'}
        </button>
      </div>
    </div>
  );
}
