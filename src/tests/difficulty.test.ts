import { describe, expect, it } from 'vitest';
import { analyze } from '../game/analysis';
import {
  DEFAULT_CONFIG,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_PRESETS,
  difficultyCoefficient,
  difficultyLabel,
} from '../game/constants';
import { createInitialState, gameReducer } from '../game/gameReducer';
import { normalizeConfig } from '../game/mapGenerator';
import { positionToIndex } from '../game/neighbors';
import { getCellVisual, shouldShowEnd } from '../game/selectors';
import type { GameState, MapConfig, Position, SliceState } from '../game/types';

const fullSlice: SliceState = { axis: 'none', level: 0, onlyExplored: false, focusRadius: 0 };

function startWith(overrides: Partial<MapConfig>): GameState {
  return gameReducer(createInitialState(), {
    type: 'START_GAME',
    config: normalizeConfig({ ...DEFAULT_CONFIG, seed: 'difficulty', ...overrides }),
    now: 0,
  });
}

describe('难度系数', () => {
  it('普通模式的默认配置正好是 1.00', () => {
    expect(difficultyCoefficient(DEFAULT_CONFIG)).toBe(1);
  });

  it('雷更多、地图更大、生命更少都会提高系数', () => {
    const base = difficultyCoefficient(DEFAULT_CONFIG);
    expect(difficultyCoefficient({ ...DEFAULT_CONFIG, mineDensity: 0.2 })).toBeGreaterThan(base);
    expect(
      difficultyCoefficient({ ...DEFAULT_CONFIG, dims: { x: 8, y: 8, z: 8 } }),
    ).toBeGreaterThan(base);
    expect(difficultyCoefficient({ ...DEFAULT_CONFIG, lives: 1 })).toBeGreaterThan(base);
    expect(difficultyCoefficient({ ...DEFAULT_CONFIG, lives: 9 })).toBeLessThan(base);
  });

  it('岩块会提高系数', () => {
    expect(difficultyCoefficient({ ...DEFAULT_CONFIG, rockDensity: 0.15 })).toBeGreaterThan(
      difficultyCoefficient(DEFAULT_CONFIG),
    );
  });

  it('隐藏终点提高难度，显示终点数字与预探索降低难度', () => {
    const base = difficultyCoefficient(DEFAULT_CONFIG);
    const hidden = difficultyCoefficient({
      ...DEFAULT_CONFIG,
      difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false },
    });
    const endNumber = difficultyCoefficient({
      ...DEFAULT_CONFIG,
      difficulty: { ...DEFAULT_DIFFICULTY, showEndNumber: true },
    });
    const prescout1 = difficultyCoefficient({
      ...DEFAULT_CONFIG,
      difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 1 },
    });
    const prescout2 = difficultyCoefficient({
      ...DEFAULT_CONFIG,
      difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 2 },
    });
    const noAnalysis = difficultyCoefficient({
      ...DEFAULT_CONFIG,
      difficulty: { ...DEFAULT_DIFFICULTY, allowAnalysis: false },
    });

    expect(hidden).toBeGreaterThan(base);
    expect(endNumber).toBeLessThan(base);
    expect(prescout1).toBeLessThan(base);
    expect(prescout2).toBeLessThan(prescout1);
    expect(noAnalysis).toBeGreaterThan(base);
  });

  it('难度档位随系数单调变化', () => {
    expect(difficultyLabel(0.4)).toBe('轻松');
    expect(difficultyLabel(0.8)).toBe('偏易');
    expect(difficultyLabel(1.2)).toBe('标准');
    expect(difficultyLabel(2.0)).toBe('偏难');
    expect(difficultyLabel(3.5)).toBe('硬核');
  });

  it('预设难度的系数依次递增', () => {
    const order = ['tutorial', 'easy', 'normal', 'hard'];
    const values = order.map((id) => {
      const preset = DIFFICULTY_PRESETS.find((p) => p.id === id)!;
      return difficultyCoefficient({
        dims: preset.dims,
        mineDensity: preset.mineDensity,
        rockDensity: preset.rockDensity,
        lives: preset.lives,
        seed: 'x',
        difficulty: preset.difficulty,
        presetId: preset.id,
      });
    });
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe('开局预探索', () => {
  it('半径为 0 时只有起点是已探索的', () => {
    const state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 0 } });
    expect(state.map!.cells.filter((c) => c.explored)).toHaveLength(1);
  });

  it('半径为 1 时起点周围的安全格被预先探索，地雷仍然隐藏', () => {
    const state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 1 } });
    const map = state.map!;
    const explored = map.cells.filter((c) => c.explored);
    expect(explored.length).toBeGreaterThan(1);
    // 预探索不会揭示任何地雷或岩块
    for (const cell of explored) {
      expect(cell.type).not.toBe('mine');
      expect(cell.type).not.toBe('rock');
    }
    // 探索范围不会超出起点周围 3×3×3
    for (const cell of explored) {
      expect(Math.abs(cell.position.x - map.start.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.position.y - map.start.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.position.z - map.start.z)).toBeLessThanOrEqual(1);
    }
  });

  it('半径越大预探索的格子越多', () => {
    const r1 = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 1 } });
    const r2 = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 2 } });
    expect(r2.map!.cells.filter((c) => c.explored).length).toBeGreaterThan(
      r1.map!.cells.filter((c) => c.explored).length,
    );
  });

  it('预探索不会改变地图本身，相同种子仍然生成相同布局', () => {
    const a = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 0 } });
    const b = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 2 } });
    expect(a.map!.cells.map((c) => c.type)).toEqual(b.map!.cells.map((c) => c.type));
    expect(a.map!.start).toEqual(b.map!.start);
    expect(a.map!.end).toEqual(b.map!.end);
  });
});

describe('隐藏终点', () => {
  const visualOf = (state: GameState, position: Position, showEnd: boolean) =>
    getCellVisual(state.map!.cells[positionToIndex(state.map!.dims, position)]!, {
      player: state.player,
      start: state.map!.start,
      end: state.map!.end,
      slice: fullSlice,
      revealAllMines: false,
      showEnd,
    });

  it('显示终点时终点带 E 标记', () => {
    const state = startWith({});
    expect(visualOf(state, state.map!.end, true).kind).toBe('end');
  });

  it('隐藏终点时终点和普通未探索格没有区别', () => {
    const state = startWith({
      difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false },
    });
    const visual = visualOf(state, state.map!.end, false);
    expect(visual.kind).toBe('unknown');
    expect(visual.label).toBe('');
  });

  it('隐藏终点时，推理不会把终点当成已知安全格', () => {
    const state = startWith({
      difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false },
      dims: { x: 5, y: 5, z: 5 },
    });
    const map = state.map!;
    // 找一个 26 邻域包含终点的已探索格作为线索
    const clue = map.cells.find(
      (cell) =>
        cell.explored &&
        Math.abs(cell.position.x - map.end.x) <= 1 &&
        Math.abs(cell.position.y - map.end.y) <= 1 &&
        Math.abs(cell.position.z - map.end.z) <= 1,
    );
    if (!clue) return; // 该种子下起点离终点较远，跳过
    const endIndex = positionToIndex(map.dims, map.end);
    const known = analyze(map, [clue.position], { endKnown: true });
    const hidden = analyze(map, [clue.position], { endKnown: false });
    expect(known.clues[0]!.unknown).not.toContain(endIndex);
    expect(hidden.clues[0]!.unknown).toContain(endIndex);
  });
});

describe('隐藏终点不会通过其他途径泄露位置', () => {
  it('半径 2 的开局预探索不会提前探索隐藏终点或显示其数字', () => {
    const state = startWith({
      dims: { x: 3, y: 3, z: 3 },
      mineDensity: 0.05,
      rockDensity: 0,
      difficulty: {
        ...DEFAULT_DIFFICULTY,
        showEndPosition: false,
        showEndNumber: false,
        prescoutRadius: 2,
      },
    });
    const map = state.map!;
    const endCell = map.cells[positionToIndex(map.dims, map.end)]!;

    expect(state.status).toBe('playing');
    expect(endCell.explored).toBe(false);
    const visual = getCellVisual(endCell, {
      player: state.player,
      start: map.start,
      end: map.end,
      slice: fullSlice,
      revealAllMines: false,
      showEnd: false,
      showEndNumber: false,
    });
    expect(visual.kind).toBe('unknown');
    expect(visual.label).toBe('');
  });

  it('终点可见时不能插旗，被隐藏时可以插旗（否则"插不了旗"本身就是提示）', () => {
    const visible = startWith({});
    const flaggedVisible = gameReducer(visible, {
      type: 'TOGGLE_FLAG',
      position: visible.map!.end,
    });
    expect(
      flaggedVisible.map!.cells[positionToIndex(visible.map!.dims, visible.map!.end)]!.mark,
    ).toBe('none');

    const hidden = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false } });
    const flaggedHidden = gameReducer(hidden, { type: 'TOGGLE_FLAG', position: hidden.map!.end });
    expect(
      flaggedHidden.map!.cells[positionToIndex(hidden.map!.dims, hidden.map!.end)]!.mark,
    ).toBe('flag');
  });

  it('隐藏终点时「只显示已探索区域」不会把终点显示出来', () => {
    const state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false } });
    const map = state.map!;
    const visual = getCellVisual(map.cells[positionToIndex(map.dims, map.end)]!, {
      player: state.player,
      start: map.start,
      end: map.end,
      slice: { axis: 'none', level: 0, onlyExplored: true, focusRadius: 0 },
      revealAllMines: false,
      showEnd: false,
    });
    expect(visual.visible).toBe(false);
  });
});

describe('结算后无条件显示终点', () => {
  it('游戏进行中，隐藏终点就是隐藏的', () => {
    const state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false } });
    expect(state.status).toBe('playing');
    expect(shouldShowEnd(state)).toBe(false);
  });

  it('胜利或失败后终点一定可见，便于复盘', () => {
    const base = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: false } });
    expect(shouldShowEnd({ ...base, status: 'won' })).toBe(true);
    expect(shouldShowEnd({ ...base, status: 'lost' })).toBe(true);
  });

  it('难度本来就显示终点时，任何阶段都可见', () => {
    const state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, showEndPosition: true } });
    expect(shouldShowEnd(state)).toBe(true);
    expect(shouldShowEnd({ ...state, status: 'lost' })).toBe(true);
  });
});

describe('分析开关', () => {
  it('难度禁用分析时无法开启分析模式', () => {
    let state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, allowAnalysis: false } });
    state = gameReducer(state, { type: 'SET_ANALYSIS', value: true });
    expect(state.analysis.enabled).toBe(false);
  });

  it('允许分析时可以正常开关', () => {
    let state = startWith({ difficulty: { ...DEFAULT_DIFFICULTY, allowAnalysis: true } });
    state = gameReducer(state, { type: 'SET_ANALYSIS', value: true });
    expect(state.analysis.enabled).toBe(true);
    state = gameReducer(state, { type: 'SET_ANALYSIS', value: false });
    expect(state.analysis.enabled).toBe(false);
  });

  it('重开一局会保留分析开关但清空线索', () => {
    let state = startWith({});
    state = gameReducer(state, { type: 'SET_ANALYSIS', value: true });
    state = gameReducer(state, { type: 'TOGGLE_CLUE', position: state.map!.start });
    expect(state.analysis.clues).toHaveLength(1);
    state = gameReducer(state, { type: 'RESTART_SAME_SEED', now: 0 });
    expect(state.analysis.enabled).toBe(true);
    expect(state.analysis.clues).toHaveLength(0);
  });
});

describe('配置规范化', () => {
  it('预探索半径会被裁剪到 0~2', () => {
    expect(
      normalizeConfig({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: 99 } }).difficulty
        .prescoutRadius,
    ).toBe(2);
    expect(
      normalizeConfig({ difficulty: { ...DEFAULT_DIFFICULTY, prescoutRadius: -5 } }).difficulty
        .prescoutRadius,
    ).toBe(0);
  });

  it('缺省的难度修正项会补上默认值', () => {
    expect(normalizeConfig({}).difficulty).toEqual(DEFAULT_DIFFICULTY);
  });
});
