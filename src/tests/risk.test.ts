import { describe, expect, it } from 'vitest';
import { EMPTY_ANALYSIS, analyze } from '../game/analysis';
import { createMapFromMines } from '../game/mapGenerator';
import { positionToIndex } from '../game/neighbors';
import { bestMove, computeMoveRisks, evaluateMove, riskLevel } from '../game/risk';
import type { Cell, Dims, GameMap, Position } from '../game/types';

const DIMS: Dims = { x: 5, y: 5, z: 5 };
const START: Position = { x: 2, y: 2, z: 2 };
const END: Position = { x: 0, y: 0, z: 0 };

function makeMap(options: {
  mines?: Position[];
  rocks?: Position[];
  explored?: Position[];
  flagged?: Position[];
  revealed?: Position[];
}): GameMap {
  const toIdx = (p: Position) => positionToIndex(DIMS, p);
  const map = createMapFromMines(
    DIMS,
    new Set((options.mines ?? []).map(toIdx)),
    START,
    END,
    { rocks: new Set((options.rocks ?? []).map(toIdx)) },
  );
  const patch = (positions: Position[] | undefined, change: Partial<Cell>) => {
    for (const p of positions ?? []) {
      const index = toIdx(p);
      map.cells[index] = { ...map.cells[index]!, ...change };
    }
  };
  patch(options.explored, { explored: true });
  patch(options.flagged, { mark: 'flag' });
  patch(options.revealed, { revealedMine: true });
  return map;
}

describe('单格风险判定', () => {
  it('地图外、岩块、已揭示地雷、旗帜都不可通行', () => {
    const map = makeMap({
      rocks: [{ x: 3, y: 2, z: 2 }],
      revealed: [{ x: 1, y: 2, z: 2 }],
      flagged: [{ x: 2, y: 3, z: 2 }],
    });
    const at = (p: Position) => evaluateMove(map, p, EMPTY_ANALYSIS);

    expect(at({ x: -1, y: 2, z: 2 }).kind).toBe('out-of-bounds');
    expect(at({ x: -1, y: 2, z: 2 }).passable).toBe(false);
    expect(at({ x: 3, y: 2, z: 2 }).kind).toBe('rock');
    expect(at({ x: 1, y: 2, z: 2 }).kind).toBe('revealed-mine');
    expect(at({ x: 2, y: 3, z: 2 }).kind).toBe('flagged');
    for (const p of [
      { x: 3, y: 2, z: 2 },
      { x: 1, y: 2, z: 2 },
      { x: 2, y: 3, z: 2 },
    ]) {
      expect(at(p).passable).toBe(false);
    }
  });

  it('已探索格、起点、终点都是已知安全', () => {
    const map = makeMap({ explored: [{ x: 2, y: 2, z: 3 }] });
    expect(evaluateMove(map, { x: 2, y: 2, z: 3 }, EMPTY_ANALYSIS).kind).toBe('known-safe');
    expect(evaluateMove(map, START, EMPTY_ANALYSIS).kind).toBe('known-safe');
    expect(evaluateMove(map, END, EMPTY_ANALYSIS).kind).toBe('known-safe');
  });

  it('隐藏终点时，终点不再被当成已知安全格', () => {
    const map = makeMap({});
    expect(evaluateMove(map, END, EMPTY_ANALYSIS, { endKnown: false }).kind).toBe('unknown');
  });

  it('分析关闭时所有未探索格都是 unknown', () => {
    const map = makeMap({ mines: [{ x: 2, y: 2, z: 1 }] });
    expect(evaluateMove(map, { x: 2, y: 2, z: 1 }, EMPTY_ANALYSIS).kind).toBe('unknown');
  });
});

describe('六方向风险', () => {
  it('返回六个方向，顺序与方向表一致', () => {
    const map = makeMap({});
    const risks = computeMoveRisks(map, START, EMPTY_ANALYSIS);
    expect(risks).toHaveLength(6);
    expect(risks.map((r) => r.direction.key)).toEqual(['W', 'S', 'A', 'D', 'E', 'Q']);
  });

  it('推理能确定安全时，对应方向被标为 safe 且概率为 0', () => {
    // 玩家所在格 26 邻域内 0 颗雷 -> 六个方向全部确定安全
    const map = makeMap({ explored: [START] });
    const analysis = analyze(map, [], { player: START });
    const risks = computeMoveRisks(map, START, analysis);
    const forward = risks.find((r) => r.direction.id === 'forward')!;
    expect(forward.risk.kind).toBe('safe');
    expect(forward.risk.probability).toBe(0);
    expect(riskLevel(forward.risk)).toBe('safe');
  });

  it('推理能确定有雷时，对应方向被标为 mine', () => {
    const line: Dims = { x: 5, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    const toIdx = (p: Position) => positionToIndex(line, p);
    const map = createMapFromMines(line, new Set([toIdx(at(2))]), at(0), at(4));
    for (const x of [1, 3]) {
      map.cells[toIdx(at(x))] = { ...map.cells[toIdx(at(x))]!, explored: true };
    }
    const analysis = analyze(map, [], { useOrthogonal: true, player: at(1) });
    const risks = computeMoveRisks(map, at(1), analysis);
    const right = risks.find((r) => r.direction.id === 'right')!;
    expect(right.risk.kind).toBe('mine');
    expect(right.risk.probability).toBe(1);
  });

  it('不确定时给出概率，并标明是否精确', () => {
    const line: Dims = { x: 9, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    const toIdx = (p: Position) => positionToIndex(line, p);
    const map = createMapFromMines(line, new Set([toIdx(at(3))]), at(0), at(8));
    map.cells[toIdx(at(4))] = { ...map.cells[toIdx(at(4))]!, explored: true };
    const analysis = analyze(map, [], { useOrthogonal: true, player: at(4) });
    const risks = computeMoveRisks(map, at(4), analysis);
    const left = risks.find((r) => r.direction.id === 'left')!;
    expect(left.risk.kind).toBe('risky');
    expect(left.risk.probability).toBeCloseTo(0.5, 6);
    expect(left.risk.exact).toBe(true);
    expect(left.risk.label).toBe('50%');
  });
});

describe('推荐下一步', () => {
  it('优先选择确定安全的方向', () => {
    const map = makeMap({ explored: [START] });
    const analysis = analyze(map, [], { player: START });
    const best = bestMove(computeMoveRisks(map, START, analysis))!;
    expect(best.risk.kind).toBe('safe');
  });

  it('没有确定安全时选择概率最低的方向', () => {
    const line: Dims = { x: 9, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    const toIdx = (p: Position) => positionToIndex(line, p);
    // 玩家在 (4)，左边两格里有 1 颗雷、右边三格里有 1 颗雷 -> 右边概率更低
    const map = createMapFromMines(line, new Set([toIdx(at(2))]), at(0), at(8));
    for (const x of [3, 4]) {
      map.cells[toIdx(at(x))] = { ...map.cells[toIdx(at(x))]!, explored: true };
    }
    const analysis = analyze(map, [], { useOrthogonal: true, player: at(4) });
    const risks = computeMoveRisks(map, at(4), analysis);
    const best = bestMove(risks)!;
    // (2,0,0) 已被确定是雷，(5,0,0) 是安全的
    expect(best.direction.id).toBe('right');
  });

  it('全部方向都不可通行时返回 null', () => {
    const map = makeMap({
      rocks: [
        { x: 1, y: 2, z: 2 },
        { x: 3, y: 2, z: 2 },
        { x: 2, y: 1, z: 2 },
        { x: 2, y: 3, z: 2 },
        { x: 2, y: 2, z: 1 },
        { x: 2, y: 2, z: 3 },
      ],
    });
    expect(bestMove(computeMoveRisks(map, START, EMPTY_ANALYSIS))).toBeNull();
  });
});

describe('风险等级', () => {
  it('按概率分档', () => {
    const make = (probability: number) => ({
      kind: 'risky' as const,
      probability,
      exact: true,
      passable: true,
      label: '',
    });
    expect(riskLevel(make(0.05))).toBe('low');
    expect(riskLevel(make(0.3))).toBe('mid');
    expect(riskLevel(make(0.8))).toBe('high');
    expect(riskLevel({ ...make(0), kind: 'safe' })).toBe('safe');
    expect(riskLevel({ ...make(1), kind: 'mine' })).toBe('mine');
    expect(riskLevel({ ...make(0), kind: 'rock' })).toBe('none');
  });
});
