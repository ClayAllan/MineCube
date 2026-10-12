import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CUSTOM_PRESET_ID,
  DIFFICULTY_PRESETS,
  MAX_DENSITY,
  MAX_DIM,
  MAX_LIVES,
  MAX_PRESCOUT_RADIUS,
  MAX_ROCK_DENSITY,
  MIN_DENSITY,
  MIN_DIM,
  MIN_LIVES,
  PERF_WARN_CELLS,
  computeMineCount,
  computeRockCount,
  difficultyCoefficient,
  difficultyLabel,
  formatDims,
  isCube,
  totalCells,
} from '../game/constants';
import { normalizeConfig, validateConfig } from '../game/mapGenerator';
import { getRecord, type RecordBook } from '../game/records';
import { randomSeedString } from '../game/seededRandom';
import type { DifficultyOptions, Dims, MapConfig } from '../game/types';
import { formatDuration, formatPercent } from '../utils/format';

const INTRO =
  '在三维雷区中寻找终点。每个已探索安全格上的数字，表示它周围 3×3×3 范围内的地雷数量。你只能向六个正交方向移动，踩中地雷会损失一条生命。';

const AXES: { key: keyof Dims; label: string; hint: string }[] = [
  { key: 'x', label: 'X（左右）', hint: '左右方向的格数' },
  { key: 'y', label: 'Y（上下）', hint: '上下方向的格数' },
  { key: 'z', label: 'Z（前后）', hint: '前后方向的格数' },
];

export interface StartScreenProps {
  initialConfig: MapConfig;
  error: string | null;
  records: RecordBook;
  onDismissError: () => void;
  onStart: (config: MapConfig) => void;
}

export function StartScreen({
  initialConfig,
  error,
  records,
  onDismissError,
  onStart,
}: StartScreenProps) {
  const [dims, setDims] = useState<Dims>(initialConfig.dims);
  const [density, setDensity] = useState(initialConfig.mineDensity);
  const [rockDensity, setRockDensity] = useState(initialConfig.rockDensity);
  const [lives, setLives] = useState(initialConfig.lives);
  const [seed, setSeed] = useState(initialConfig.seed);
  const [presetId, setPresetId] = useState(initialConfig.presetId);
  const [difficulty, setDifficultyState] = useState<DifficultyOptions>(initialConfig.difficulty);

  const setDifficulty = (patch: Partial<DifficultyOptions>) => {
    setPresetId(CUSTOM_PRESET_ID);
    setDifficultyState((current) => ({ ...current, ...patch }));
  };
  // 锁定后三个方向一起变，方便快速做立方体地图
  const [lockCube, setLockCube] = useState(isCube(initialConfig.dims));

  const issues = useMemo(
    () => validateConfig({ dims, mineDensity: density, rockDensity, lives, seed }),
    [dims, density, rockDensity, lives, seed],
  );
  const coefficient = useMemo(
    () =>
      difficultyCoefficient({
        dims,
        mineDensity: density,
        rockDensity,
        lives,
        seed,
        difficulty,
        presetId,
      }),
    [dims, density, rockDensity, lives, seed, difficulty, presetId],
  );
  const record = useMemo(
    () =>
      getRecord(records, {
        dims,
        mineDensity: density,
        rockDensity,
        lives,
        seed,
        difficulty,
        presetId,
      }),
    [records, dims, density, rockDensity, lives, seed, difficulty, presetId],
  );
  const cells = totalCells(dims);
  const mineCount = computeMineCount(dims, density);
  const rockCount = computeRockCount(dims, rockDensity);

  const applyPreset = (id: string) => {
    const preset = DIFFICULTY_PRESETS.find((p) => p.id === id);
    setPresetId(id);
    if (!preset) return;
    setDims(preset.dims);
    setDensity(preset.mineDensity);
    setRockDensity(preset.rockDensity);
    setLives(preset.lives);
    setDifficultyState(preset.difficulty);
    setLockCube(isCube(preset.dims));
  };

  const setAxis = (axis: keyof Dims, value: number) => {
    setPresetId(CUSTOM_PRESET_ID);
    setDims((current) =>
      lockCube ? { x: value, y: value, z: value } : { ...current, [axis]: value },
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (issues.length > 0) return;
    onStart(
      normalizeConfig({
        dims,
        mineDensity: density,
        rockDensity,
        lives,
        seed: seed.trim(),
        difficulty,
        presetId,
      }),
    );
  };

  return (
    <motion.div 
      className="start-screen"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <form className="start-card" onSubmit={handleSubmit}>
        <header className="start-card__header">
          <h1 className="start-card__title">
            Minecube<span className="start-card__title-sub">：3D 扫雷迷宫</span>
          </h1>
          <p className="start-card__intro">{INTRO}</p>
        </header>

        {error ? (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDismissError}>
              关闭
            </button>
          </div>
        ) : null}

        <section className="start-section">
          <h2 className="start-section__title">选择难度</h2>
          <div className="preset-grid">
            {DIFFICULTY_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={`preset-card${presetId === preset.id ? ' preset-card--active' : ''}`}
                onClick={() => applyPreset(preset.id)}
                aria-pressed={presetId === preset.id}
              >
                <span className="preset-card__name">{preset.name}</span>
                <span className="preset-card__meta">
                  {formatDims(preset.dims)} · 雷 {Math.round(preset.mineDensity * 100)}%
                  {preset.rockDensity > 0 ? ` · 岩块 ${Math.round(preset.rockDensity * 100)}%` : ''} ·
                  生命 {preset.lives}
                </span>
                <span className="preset-card__desc">{preset.description}</span>
              </button>
            ))}
            <button
              type="button"
              className={`preset-card${presetId === CUSTOM_PRESET_ID ? ' preset-card--active' : ''}`}
              onClick={() => setPresetId(CUSTOM_PRESET_ID)}
              aria-pressed={presetId === CUSTOM_PRESET_ID}
            >
              <span className="preset-card__name">自定义模式</span>
              <span className="preset-card__meta">三个方向可以不同，自由设置密度、生命与种子</span>
              <span className="preset-card__desc">想挑战特定配置时使用。</span>
            </button>
          </div>
        </section>

        <section className="start-section">
          <h2 className="start-section__title">地图尺寸</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={lockCube}
              onChange={(e) => {
                setLockCube(e.target.checked);
                if (e.target.checked) setDims((c) => ({ x: c.x, y: c.x, z: c.x }));
              }}
            />
            <span>保持立方体（三个方向同时变化）</span>
          </label>

          {AXES.map((axis) => (
            <div className="field" key={axis.key}>
              <label className="field__label" htmlFor={`dim-${axis.key}`}>
                {axis.label}
                <span className="field__value">{dims[axis.key]} 格</span>
              </label>
              <input
                id={`dim-${axis.key}`}
                type="range"
                min={MIN_DIM}
                max={MAX_DIM}
                step={1}
                value={dims[axis.key]}
                title={axis.hint}
                onChange={(e) => setAxis(axis.key, Number(e.target.value))}
              />
            </div>
          ))}

          <p className="panel__note">
            当前地图：<strong>{formatDims(dims)}</strong>，共 {cells} 格。
            {cells > PERF_WARN_CELLS ? '格数较多，低端显卡上可能掉帧。' : ''}
          </p>
        </section>

        <section className="start-section">
          <h2 className="start-section__title">雷区与地形</h2>
          <div className="field">
            <label className="field__label" htmlFor="density">
              地雷密度
              <span className="field__value">
                {Math.round(density * 100)}%（约 {mineCount} 颗雷）
              </span>
            </label>
            <input
              id="density"
              type="range"
              min={MIN_DENSITY * 100}
              max={MAX_DENSITY * 100}
              step={1}
              value={Math.round(density * 100)}
              onChange={(e) => {
                setDensity(Number(e.target.value) / 100);
                setPresetId(CUSTOM_PRESET_ID);
              }}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="rock-density">
              岩块密度
              <span className="field__value">
                {Math.round(rockDensity * 100)}%
                {rockDensity > 0 ? `（约 ${rockCount} 块）` : '（不生成岩块）'}
              </span>
            </label>
            <input
              id="rock-density"
              type="range"
              min={0}
              max={MAX_ROCK_DENSITY * 100}
              step={1}
              value={Math.round(rockDensity * 100)}
              onChange={(e) => {
                setRockDensity(Number(e.target.value) / 100);
                setPresetId(CUSTOM_PRESET_ID);
              }}
            />
            <p className="panel__note">
              岩块是成簇生成的实心地形：不是地雷、不计入数字、撞上去不扣血，但永远挡路。
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="lives">
              初始生命<span className="field__value">{lives} 条</span>
            </label>
            <input
              id="lives"
              type="range"
              min={MIN_LIVES}
              max={MAX_LIVES}
              step={1}
              value={lives}
              onChange={(e) => {
                setLives(Number(e.target.value));
                setPresetId(CUSTOM_PRESET_ID);
              }}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="seed">
              随机种子<span className="field__value">数字或短字符串均可</span>
            </label>
            <div className="field__row">
              <input
                id="seed"
                className="text-input"
                type="text"
                value={seed}
                maxLength={40}
                placeholder="例如 minecube 或 20260727"
                onChange={(e) => setSeed(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => setSeed(randomSeedString())}>
                随机生成种子
              </button>
            </div>
          </div>

          {issues.length > 0 ? (
            <ul className="issue-list">
              {issues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="start-section">
          <h2 className="start-section__title">难度修正项</h2>
          <p className="panel__note">
            这些开关不改变地图本身，只改变你能拿到多少信息，因此可以独立调节难度。
          </p>

          <label className="switch">
            <input
              type="checkbox"
              checked={difficulty.showEndPosition}
              onChange={(e) => setDifficulty({ showEndPosition: e.target.checked })}
            />
            <span>
              显示终点位置<em className="switch__hint">关闭后只提供到终点的曼哈顿距离（×1.35）</em>
            </span>
          </label>

          <label className="switch">
            <input
              type="checkbox"
              checked={difficulty.showEndNumber}
              onChange={(e) => setDifficulty({ showEndNumber: e.target.checked })}
            />
            <span>
              显示终点格的数字<em className="switch__hint">提前知道终点附近的雷数（×0.92）</em>
            </span>
          </label>

          <label className="switch">
            <input
              type="checkbox"
              checked={difficulty.showOrthogonalCount}
              onChange={(e) => setDifficulty({ showOrthogonalCount: e.target.checked })}
            />
            <span>
              额外显示六邻域雷数
              <em className="switch__hint">
                每格再给一个「六个正交邻格里有几颗雷」的数字。26 邻域在三维里太粗，
                这个数字才让内部区域真正可推理（×0.75）
              </em>
            </span>
          </label>

          <label className="switch">
            <input
              type="checkbox"
              checked={difficulty.allowAnalysis}
              onChange={(e) => setDifficulty({ allowAnalysis: e.target.checked })}
            />
            <span>
              允许使用推理分析面板<em className="switch__hint">关闭后只能自己心算（×1.12）</em>
            </span>
          </label>

          <div className="field">
            <label className="field__label" htmlFor="prescout">
              开局预探索半径
              <span className="field__value">
                {difficulty.prescoutRadius === 0
                  ? '关闭'
                  : `${difficulty.prescoutRadius} 格（${(difficulty.prescoutRadius * 2 + 1) ** 3} 格范围）`}
              </span>
            </label>
            <input
              id="prescout"
              type="range"
              min={0}
              max={MAX_PRESCOUT_RADIUS}
              step={1}
              value={difficulty.prescoutRadius}
              onChange={(e) => setDifficulty({ prescoutRadius: Number(e.target.value) })}
            />
            <p className="panel__note">
              开局就把起点周围的安全格标记为已探索（地雷仍然隐藏），直接获得一圈数字。
            </p>
          </div>

          <div className="difficulty-summary">
            <span className="difficulty-summary__label">难度系数</span>
            <span className="difficulty-summary__value">{coefficient.toFixed(2)}</span>
            <span className="difficulty-summary__tag">{difficultyLabel(coefficient)}</span>
            <span className="difficulty-summary__hint">普通模式的默认配置为 1.00</span>
          </div>

          {record ? (
            <p className="notice">
              这套配置的本地记录：
              {record.wins > 0
                ? `最佳用时 ${formatDuration(record.bestTimeMs ?? 0)} · 最佳路线效率 ${formatPercent(
                    record.bestEfficiency ?? 0,
                  )} · 最少 ${record.bestMoves} 步`
                : '还没有通关过'}
              （{record.wins} 胜 / {record.losses} 负）
            </p>
          ) : (
            <p className="panel__note">这套配置还没有游玩记录。</p>
          )}
        </section>

        <section className="start-section">
          <h2 className="start-section__title">操作说明</h2>
          <ul className="help-list">
            <li><kbd>W</kbd>/<kbd>S</kbd> 或 <kbd>↑</kbd>/<kbd>↓</kbd>：向前 / 向后（朝视野深处移动）</li>
            <li><kbd>A</kbd>/<kbd>D</kbd> 或 <kbd>←</kbd>/<kbd>→</kbd>：向左 / 向右（朝视野左右移动）</li>
            <li><kbd>Q</kbd>/<kbd>E</kbd>：向下 / 向上（垂直高度）</li>
            <li>已默认开启「视角相对移动」，按键方向随旋转镜头始终保持直观一致</li>
            <li>
              <kbd>Shift</kbd> + 方向键：移动「选中格光标」，可以穿到地图内部
            </li>
            <li><kbd>F</kbd>：给当前选中的格子插旗或取消</li>
            <li><kbd>G</kbd>：把选中格光标移回玩家位置</li>
            <li><kbd>空格</kbd>：暂停 / 继续</li>
            <li>鼠标拖动旋转视角，滚轮缩放，右键点击格子插旗</li>
            <li>被外层挡住的格子：在同一位置连续左键点击可依次向内切换</li>
          </ul>
        </section>

        <button type="submit" className="btn btn--primary btn--lg" disabled={issues.length > 0}>
          开始游戏
        </button>
      </form>
    </motion.div>
  );
}
