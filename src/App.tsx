import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { playFeedbackSound } from './audio/sfx';
import { createInitialState, gameReducer } from './game/gameReducer';
import {
  NO_IMPROVEMENTS,
  applyResult,
  getRecord,
  type RecordImprovements,
} from './game/records';
import { computeStats } from './game/selectors';
import type { MapConfig } from './game/types';
import { useGameTimer } from './hooks/useGameTimer';
import { useRecords } from './hooks/useRecords';
import { loadStoredConfig, useStoreConfig } from './hooks/useStoredConfig';
import { isWebGLAvailable } from './render/webgl';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameScreen } from './components/GameScreen';
import { StartScreen } from './components/StartScreen';

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, loadStoredConfig(), createInitialState);
  const storeConfig = useStoreConfig();
  const [webglAvailable] = useState(() => isWebGLAvailable());
  const { records, updateRecords } = useRecords();
  const lastSoundId = useRef(0);

  useGameTimer(state.status, dispatch);

  // 音效：只在收到新的反馈事件时播放一次
  useEffect(() => {
    const feedback = state.feedback;
    if (!feedback || feedback.id === lastSoundId.current) return;
    lastSoundId.current = feedback.id;
    if (state.soundEnabled) playFeedbackSound(feedback.type);
  }, [state.feedback, state.soundEnabled]);

  const handleStart = useCallback(
    (config: MapConfig) => {
      storeConfig(config);
      dispatch({ type: 'START_GAME', config });
    },
    [storeConfig],
  );

  const handleBackToSetup = useCallback(() => dispatch({ type: 'BACK_TO_SETUP' }), []);
  const handleDismissError = useCallback(() => dispatch({ type: 'DISMISS_ERROR' }), []);

  const initialConfig = useMemo(() => state.config, [state.config]);

  // 一局结束时并入本地记录；用 gameId 防止同一局被重复统计
  const recordedGameId = useRef(-1);
  const [improvements, setImprovements] = useState<RecordImprovements>(NO_IMPROVEMENTS);

  useEffect(() => {
    const finished = state.status === 'won' || state.status === 'lost';
    if (!finished || recordedGameId.current === state.gameId) return;
    recordedGameId.current = state.gameId;

    const stats = computeStats(state);
    if (!stats) return;
    const result = applyResult(records, state.config, {
      won: state.status === 'won',
      elapsedMs: stats.elapsedMs,
      moves: stats.moves,
      routeEfficiency: stats.routeEfficiency,
    });
    updateRecords(result.book);
    setImprovements(result.improvements);
  }, [state, records, updateRecords]);

  // 新的一局开始时清掉上一局的「新纪录」标记
  useEffect(() => {
    if (state.status === 'playing') setImprovements(NO_IMPROVEMENTS);
  }, [state.gameId, state.status]);

  return (
    <ErrorBoundary title="游戏出现了一个错误">
      {state.status === 'setup' || !state.map ? (
        <StartScreen
          initialConfig={initialConfig}
          error={state.error}
          records={records}
          onDismissError={handleDismissError}
          onStart={handleStart}
        />
      ) : (
        <GameScreen
          state={state}
          dispatch={dispatch}
          webglAvailable={webglAvailable}
          record={getRecord(records, state.config)}
          improvements={improvements}
          onBackToSetup={handleBackToSetup}
        />
      )}
    </ErrorBoundary>
  );
}
