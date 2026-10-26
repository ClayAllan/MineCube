import { describe, expect, it } from 'vitest';
import { createInitialState, gameReducer } from '../game/gameReducer';
import { createMapFromMines } from '../game/mapGenerator';
import { positionToIndex } from '../game/neighbors';
import { computeStats, getCell, routeEfficiency } from '../game/selectors';
import type { Dims, GameState, Position } from '../game/types';

const SIZE: Dims = { x: 4, y: 4, z: 4 };
const START: Position = { x: 0, y: 0, z: 0 };
const END: Position = { x: 3, y: 0, z: 0 };
const MINE: Position = { x: 1, y: 0, z: 0 };
const idx = (p: Position) => positionToIndex(SIZE, p);

/** 构造一张固定的测试地图：起点 (0,0,0)，终点 (3,0,0)，(1,0,0) 是唯一地雷 */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const map = createMapFromMines(SIZE, new Set([idx(MINE)]), START, END);
  const base = createInitialState({
    dims: SIZE,
    mineDensity: 0.1,
    lives: 3,
    seed: 'test',
    presetId: 'custom',
  });
  return {
    ...base,
    status: 'playing',
    map,
    player: { ...START },
    lives: 3,
    initialLives: 3,
    runningSince: 0,
    ...overrides,
  };
}

describe('移动', () => {
  it('安全移动会更新位置、步数，并把目标格标记为已探索', () => {
    const state = makeState();
    const next = gameReducer(state, { type: 'MOVE', direction: 'up' });
    expect(next.player).toEqual({ x: 0, y: 1, z: 0 });
    expect(next.moves).toBe(1);
    expect(getCell(next, { x: 0, y: 1, z: 0 })!.explored).toBe(true);
    expect(next.lives).toBe(3);
  });

  it('已探索的数字信息会永久保留', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'MOVE', direction: 'up' });
    const explored = { x: 0, y: 1, z: 0 };
    state = gameReducer(state, { type: 'MOVE', direction: 'down' });
    expect(state.player).toEqual(START);
    expect(getCell(state, explored)!.explored).toBe(true);
  });

  it('地图外的移动无效，位置和步数都不变', () => {
    const state = makeState();
    const next = gameReducer(state, { type: 'MOVE', direction: 'left' });
    expect(next.player).toEqual(START);
    expect(next.moves).toBe(0);
    expect(next.feedback?.type).toBe('blocked');
  });

  it('只能六方向移动：斜向不是合法的方向 id', () => {
    const state = makeState();
    // @ts-expect-error 故意传入非法方向，验证 reducer 不会崩溃
    const next = gameReducer(state, { type: 'MOVE', direction: 'up-left' });
    expect(next).toBe(state);
  });

  it('抵达终点后游戏胜利并停止计时', () => {
    let state = makeState({ player: { x: 2, y: 0, z: 0 } });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(state.player).toEqual(END);
    expect(state.status).toBe('won');
    expect(state.runningSince).toBeNull();
  });

  it('结束状态下继续输入不会改变游戏', () => {
    let state = makeState({ player: { x: 2, y: 0, z: 0 } });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    const afterWin = gameReducer(state, { type: 'MOVE', direction: 'up' });
    expect(afterWin).toBe(state);
  });
});

describe('踩雷与生命', () => {
  it('踩雷后位置不变、生命减一、踩雷次数加一、地雷被永久揭示', () => {
    const state = makeState();
    const next = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(next.player).toEqual(START);
    expect(next.lives).toBe(2);
    expect(next.mineHits).toBe(1);
    expect(next.moves).toBe(0);
    expect(getCell(next, MINE)!.revealedMine).toBe(true);
    expect(next.status).toBe('playing');
    expect(next.feedback?.type).toBe('mine');
  });

  it('踩雷会自动移除该格上的旗帜', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    expect(getCell(state, MINE)!.mark).toBe('flag');
    // 插旗后必须先取消旗帜才能尝试进入
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(getCell(state, MINE)!.mark).toBe('none');
    expect(getCell(state, MINE)!.revealedMine).toBe(true);
  });

  it('已揭示的地雷是不可通行障碍，不会重复扣血', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    const livesAfterHit = state.lives;
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(state.lives).toBe(livesAfterHit);
    expect(state.mineHits).toBe(1);
    expect(state.feedback?.type).toBe('mine-blocked');
  });

  it('生命降到零后游戏失败并揭示全部地雷', () => {
    let state = makeState({ lives: 1, initialLives: 1 });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(state.lives).toBe(0);
    expect(state.status).toBe('lost');
    expect(state.revealAllMines).toBe(true);
    expect(state.map!.cells.filter((c) => c.type === 'mine').every((c) => c.revealedMine)).toBe(true);
    // 失败后禁止继续移动
    expect(gameReducer(state, { type: 'MOVE', direction: 'up' })).toBe(state);
  });
});

describe('剩余地雷计数', () => {
  /** HUD 与推理引擎用的是同一个口径：总数 − 已插旗 − 已揭示 */
  const remaining = (state: GameState) => {
    const map = state.map!;
    const flags = map.cells.filter((c) => c.mark === 'flag').length;
    const revealed = map.cells.filter((c) => c.revealedMine).length;
    return map.mineCount - flags - revealed;
  };

  it('插旗后剩余地雷数减少，取消旗帜后恢复', () => {
    let state = makeState();
    expect(remaining(state)).toBe(1);
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: { x: 1, y: 1, z: 0 } });
    expect(remaining(state)).toBe(0);
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: { x: 1, y: 1, z: 0 } });
    expect(remaining(state)).toBe(1);
  });

  it('踩雷后旗帜被清掉，但揭示的雷仍然计入，不会重复扣减', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    expect(remaining(state)).toBe(0);
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(getCell(state, MINE)!.revealedMine).toBe(true);
    expect(getCell(state, MINE)!.mark).toBe('none');
    expect(remaining(state)).toBe(0);
  });
});

describe('岩块地形', () => {
  const ROCK: Position = { x: 0, y: 1, z: 0 };

  /** 起点 (0,0,0)，终点 (3,0,0)，(1,0,0) 是雷，(0,1,0) 是岩块 */
  function rockState(overrides: Partial<GameState> = {}): GameState {
    const map = createMapFromMines(SIZE, new Set([idx(MINE)]), START, END, {
      rocks: new Set([idx(ROCK)]),
    });
    return { ...makeState(), map, ...overrides };
  }

  it('岩块挡路：位置不变、步数不变，但不扣血也不算踩雷', () => {
    const state = rockState();
    const next = gameReducer(state, { type: 'MOVE', direction: 'up' });
    expect(next.player).toEqual(START);
    expect(next.moves).toBe(0);
    expect(next.lives).toBe(3);
    expect(next.mineHits).toBe(0);
    expect(next.feedback?.type).toBe('blocked');
    expect(next.feedback?.message).toContain('岩块');
  });

  it('岩块不能插旗', () => {
    let state = rockState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: ROCK });
    expect(getCell(state, ROCK)!.mark).toBe('none');
  });

  it('岩块不计入邻域雷数，也不会被当成地雷揭示', () => {
    const state = rockState();
    const rockCell = getCell(state, ROCK)!;
    expect(rockCell.type).toBe('rock');
    expect(state.map!.rockCount).toBe(1);
    expect(state.map!.mineCount).toBe(1);
    // (0,0,0) 的 26 邻域里只有 (1,0,0) 那一颗雷，岩块不计入
    expect(getCell(state, START)!.adjacentMineCount).toBe(1);
  });

  it('最短路径会绕开岩块', () => {
    const withoutRock = createMapFromMines(SIZE, new Set([idx(MINE)]), START, END);
    const withRock = createMapFromMines(SIZE, new Set([idx(MINE)]), START, END, {
      rocks: new Set([idx(ROCK)]),
    });
    expect(withRock.shortestPathLength).toBeGreaterThanOrEqual(withoutRock.shortestPathLength);
    expect(withRock.shortestPathLength).toBeGreaterThan(0);
  });
});

describe('选中格光标', () => {
  it('玩家移动不会改变选中格，F 键因此仍能作用在原来的目标上', () => {
    let state = makeState({ selected: { x: 1, y: 1, z: 0 } });
    state = gameReducer(state, { type: 'MOVE', direction: 'up' });
    expect(state.player).toEqual({ x: 0, y: 1, z: 0 });
    expect(state.selected).toEqual({ x: 1, y: 1, z: 0 });
  });

  it('踩雷与被旗帜拦截时同样不会抢走选中格', () => {
    let state = makeState({ selected: { x: 0, y: 2, z: 0 } });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(state.mineHits).toBe(1);
    expect(state.selected).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('MOVE_CURSOR 沿六方向移动光标，可以进入立方体内部', () => {
    let state = makeState({ selected: { x: 0, y: 0, z: 0 } });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'right' });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'up' });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'back' });
    expect(state.selected).toEqual({ x: 1, y: 1, z: 1 });
    expect(state.player).toEqual(START);
  });

  it('光标未设置时从玩家位置开始移动', () => {
    const state = gameReducer(makeState({ selected: null }), {
      type: 'MOVE_CURSOR',
      direction: 'up',
    });
    expect(state.selected).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('光标不会移出地图边界', () => {
    const state = makeState({ selected: { x: 0, y: 0, z: 0 } });
    const next = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'left' });
    expect(next.selected).toEqual({ x: 0, y: 0, z: 0 });
    expect(next.feedback?.type).toBe('blocked');
  });

  it('CURSOR_TO_PLAYER 把光标收回玩家位置', () => {
    let state = makeState({ selected: { x: 3, y: 3, z: 3 } });
    state = gameReducer(state, { type: 'CURSOR_TO_PLAYER' });
    expect(state.selected).toEqual(START);
  });

  it('光标移到内部格后可以直接插旗（修复：内部格无法插旗）', () => {
    let state = makeState({ selected: null });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'right' });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'up' });
    state = gameReducer(state, { type: 'MOVE_CURSOR', direction: 'back' });
    const inner = state.selected!;
    expect(inner).toEqual({ x: 1, y: 1, z: 1 });
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: inner });
    expect(getCell(state, inner)!.mark).toBe('flag');
  });

  it('MOVE_CURSOR 面对非法坐标类型时静默返回当前状态', () => {
    const invalidState = {
      ...makeState(),
      selected: { x: 'invalid' as unknown as number, y: 0, z: 0 },
    };
    const next = gameReducer(invalidState, { type: 'MOVE_CURSOR', direction: 'right' });
    expect(next).toBe(invalidState);
  });
});

describe('插旗', () => {
  it('标记按「无 → 旗 → 问号 → 无」三态循环', () => {
    const target: Position = { x: 1, y: 1, z: 0 };
    let state = makeState();
    expect(getCell(state, target)!.mark).toBe('none');
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(getCell(state, target)!.mark).toBe('flag');
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(getCell(state, target)!.mark).toBe('unsure');
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(getCell(state, target)!.mark).toBe('none');
  });

  it('已探索安全格不能插旗', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'MOVE', direction: 'up' });
    const explored: Position = { x: 0, y: 1, z: 0 };
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: explored });
    expect(getCell(state, explored)!.mark).toBe('none');
  });

  it('起点与终点不能插旗', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: START });
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: END });
    expect(getCell(state, START)!.mark).toBe('none');
    expect(getCell(state, END)!.mark).toBe('none');
  });

  it('插旗格不能直接进入，必须先取消旗帜', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    const next = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(next.player).toEqual(START);
    expect(next.lives).toBe(3);
    expect(next.feedback?.type).toBe('flag-blocked');
    expect(getCell(next, MINE)!.revealedMine).toBe(false);
  });

  it('问号不阻挡移动，旗帜才阻挡', () => {
    let state = makeState();
    // 先插旗：被拦住
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    let next = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(next.player).toEqual(START);
    expect(next.feedback?.type).toBe('flag-blocked');

    // 再按一次变成问号：可以走进去（于是踩雷）
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    expect(getCell(state, MINE)!.mark).toBe('unsure');
    next = gameReducer(state, { type: 'MOVE', direction: 'right' });
    expect(next.mineHits).toBe(1);
    expect(getCell(next, MINE)!.revealedMine).toBe(true);
    // 踩雷后标记被清掉
    expect(getCell(next, MINE)!.mark).toBe('none');
  });

  it('问号不计入剩余地雷数，旗帜才计入', () => {
    const target: Position = { x: 1, y: 1, z: 0 };
    const flags = (s: GameState) => s.map!.cells.filter((c) => c.mark === 'flag').length;
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(flags(state)).toBe(1);
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(getCell(state, target)!.mark).toBe('unsure');
    expect(flags(state)).toBe(0);
  });

  it('走进安全格会清掉它上面的问号', () => {
    const target: Position = { x: 0, y: 1, z: 0 };
    let state = makeState();
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: target });
    expect(getCell(state, target)!.mark).toBe('unsure');
    state = gameReducer(state, { type: 'MOVE', direction: 'up' });
    expect(state.player).toEqual(target);
    expect(getCell(state, target)!.mark).toBe('none');
  });

  it('地图外坐标插旗不会崩溃', () => {
    const state = makeState();
    expect(gameReducer(state, { type: 'TOGGLE_FLAG', position: { x: -1, y: 0, z: 0 } })).toBe(state);
  });

  it('已揭示的地雷不能插旗', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    state = gameReducer(state, { type: 'TOGGLE_FLAG', position: MINE });
    expect(getCell(state, MINE)!.mark).toBe('none');
  });
});

describe('切片与视图控制', () => {
  it('切换切片轴时层级会跟随玩家所在层', () => {
    const state = makeState({ player: { x: 2, y: 1, z: 3 } });
    expect(gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'z' }).slice.level).toBe(3);
    expect(gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'y' }).slice.level).toBe(1);
  });

  it('切片层级会被限制在当前轴的 [0, 长度-1] 范围内', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'y', level: 0 });
    expect(gameReducer(state, { type: 'SET_SLICE_LEVEL', level: 99 }).slice.level).toBe(SIZE.y - 1);
    expect(gameReducer(state, { type: 'SET_SLICE_LEVEL', level: -5 }).slice.level).toBe(0);
  });

  it('非立方体地图上，每个轴的层数各自独立', () => {
    const dims: Dims = { x: 3, y: 6, z: 4 };
    const map = createMapFromMines(dims, new Set(), { x: 0, y: 0, z: 0 }, { x: 2, y: 5, z: 3 });
    let state = makeState({ map, player: { x: 0, y: 0, z: 0 } });
    state = gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'y', level: 99 });
    expect(state.slice.level).toBe(5);
    state = gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'x', level: 99 });
    expect(state.slice.level).toBe(2);
  });

  it('跳转到玩家所在层', () => {
    let state = makeState({ player: { x: 2, y: 0, z: 0 } });
    state = gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'x', level: 0 });
    state = gameReducer(state, { type: 'JUMP_TO_PLAYER_LAYER' });
    expect(state.slice.level).toBe(2);
  });

  it('恢复完整立方体', () => {
    let state = makeState();
    state = gameReducer(state, { type: 'SET_SLICE_AXIS', axis: 'x', level: 1 });
    state = gameReducer(state, { type: 'SET_ONLY_EXPLORED', value: true });
    state = gameReducer(state, { type: 'RESET_VIEW' });
    expect(state.slice.axis).toBe('none');
    expect(state.slice.onlyExplored).toBe(false);
  });
});

describe('计时与暂停', () => {
  it('TICK 累加已用时间', () => {
    const state = makeState({ runningSince: 1000, accumulatedMs: 0 });
    const next = gameReducer(state, { type: 'TICK', now: 4000 });
    expect(next.elapsedMs).toBe(3000);
  });

  it('暂停会停止计时并禁止移动，恢复后继续计时', () => {
    let state = makeState({ runningSince: 1000 });
    state = gameReducer(state, { type: 'PAUSE', now: 3000 });
    expect(state.status).toBe('paused');
    expect(state.elapsedMs).toBe(2000);
    expect(gameReducer(state, { type: 'MOVE', direction: 'up' })).toBe(state);
    expect(gameReducer(state, { type: 'TICK', now: 9999 }).elapsedMs).toBe(2000);

    state = gameReducer(state, { type: 'RESUME', now: 5000 });
    expect(state.status).toBe('playing');
    expect(gameReducer(state, { type: 'TICK', now: 6000 }).elapsedMs).toBe(3000);
  });
});

describe('开始 / 重开', () => {
  it('START_GAME 生成地图并把玩家放在起点', () => {
    const state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      config: { dims: { x: 5, y: 5, z: 5 }, mineDensity: 0.12, lives: 3, seed: 'start-test', presetId: 'custom' },
      now: 0,
    });
    expect(state.status).toBe('playing');
    expect(state.map).not.toBeNull();
    expect(state.player).toEqual(state.map!.start);
    expect(state.lives).toBe(3);
    expect(state.moves).toBe(0);
  });

  it('使用相同种子重玩会得到完全相同的地图，并重置进度', () => {
    let state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      config: { dims: { x: 5, y: 5, z: 5 }, mineDensity: 0.12, lives: 3, seed: 'replay', presetId: 'custom' },
      now: 0,
    });
    const original = state.map!;
    state = gameReducer(state, { type: 'MOVE', direction: 'up' });
    state = gameReducer(state, { type: 'RESTART_SAME_SEED', now: 0 });

    expect(state.map!.start).toEqual(original.start);
    expect(state.map!.end).toEqual(original.end);
    expect(state.map!.cells.map((c) => c.type)).toEqual(original.cells.map((c) => c.type));
    expect(state.moves).toBe(0);
    expect(state.elapsedMs).toBe(0);
    expect(state.map!.cells.filter((c) => c.explored)).toHaveLength(1);
  });

  it('NEW_MAP 使用新种子，BACK_TO_SETUP 回到设置界面', () => {
    let state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      config: { dims: { x: 5, y: 5, z: 5 }, mineDensity: 0.12, lives: 3, seed: 'aaa', presetId: 'custom' },
      now: 0,
    });
    state = gameReducer(state, { type: 'NEW_MAP', seed: 'bbb', now: 0 });
    expect(state.config.seed).toBe('bbb');
    state = gameReducer(state, { type: 'BACK_TO_SETUP' });
    expect(state.status).toBe('setup');
    expect(state.map).toBeNull();
    expect(state.config.seed).not.toBe('bbb');
  });
});

describe('统计', () => {
  it('路线效率限制在 0%~100%，回头路会降低效率', () => {
    expect(routeEfficiency(10, 10)).toBe(1);
    expect(routeEfficiency(10, 20)).toBe(0.5);
    expect(routeEfficiency(10, 5)).toBe(1);
    expect(routeEfficiency(10, 0)).toBe(0);
    expect(routeEfficiency(-1, 10)).toBe(0);
  });

  it('结算统计包含完整字段', () => {
    let state = makeState({ player: { x: 2, y: 0, z: 0 }, moves: 5 });
    state = gameReducer(state, { type: 'MOVE', direction: 'right' });
    const stats = computeStats(state)!;
    expect(stats.moves).toBe(6);
    expect(stats.totalCells).toBe(64);
    expect(stats.exploredCount).toBeGreaterThanOrEqual(1);
    expect(stats.exploredRatio).toBeGreaterThan(0);
    expect(stats.shortestPathLength).toBeGreaterThan(0);
    expect(stats.routeEfficiency).toBeGreaterThan(0);
    expect(stats.routeEfficiency).toBeLessThanOrEqual(1);
    expect(stats.dims).toEqual(SIZE);
  });
});
