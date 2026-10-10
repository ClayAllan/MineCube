import { describe, expect, it } from 'vitest';
import { analyze, isClueCandidate } from '../game/analysis';
import { createMapFromMines } from '../game/mapGenerator';
import { positionToIndex } from '../game/neighbors';
import type { Cell, Dims, GameMap, Position } from '../game/types';

const DIMS: Dims = { x: 5, y: 5, z: 5 };
const START: Position = { x: 0, y: 0, z: 0 };
const END: Position = { x: 4, y: 4, z: 4 };
const idx = (p: Position) => positionToIndex(DIMS, p);

/** 构造一张固定地图，并把指定格子标记为已探索 / 已插旗 */
function makeMap(options: {
  mines?: Position[];
  rocks?: Position[];
  explored?: Position[];
  flagged?: Position[];
  revealed?: Position[];
  dims?: Dims;
  start?: Position;
  end?: Position;
}): GameMap {
  const dims = options.dims ?? DIMS;
  const start = options.start ?? START;
  const end = options.end ?? END;
  const toIdx = (p: Position) => positionToIndex(dims, p);
  const mines = new Set((options.mines ?? []).map(toIdx));
  const rocks = new Set((options.rocks ?? []).map(toIdx));
  const map = createMapFromMines(dims, mines, start, end, { rocks });
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

describe('线索格判定', () => {
  it('只有已探索格或玩家所在格能作为约束来源', () => {
    const map = makeMap({ explored: [{ x: 2, y: 2, z: 2 }] });
    const explored = map.cells[idx({ x: 2, y: 2, z: 2 })]!;
    const unexplored = map.cells[idx({ x: 3, y: 3, z: 3 })]!;
    expect(isClueCandidate(explored, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(isClueCandidate(unexplored, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(isClueCandidate(unexplored, { x: 3, y: 3, z: 3 })).toBe(true);
  });
});

describe('全局约束：不再需要手选线索', () => {
  it('不传任何聚焦线索也会用全部已探索格推理', () => {
    const clue: Position = { x: 2, y: 2, z: 2 };
    const map = makeMap({ mines: [], explored: [clue] });
    const result = analyze(map, []);
    expect(result.constraintCount).toBeGreaterThan(0);
    // 数字为 0，26 邻域全部安全
    expect(result.definiteSafe.length).toBeGreaterThan(0);
  });

  it('聚焦线索只影响交集高亮，不影响推理结论', () => {
    const clue: Position = { x: 2, y: 2, z: 2 };
    const map = makeMap({ mines: [], explored: [clue] });
    const without = analyze(map, []);
    const withFocus = analyze(map, [clue]);
    expect(withFocus.definiteSafe.sort()).toEqual(without.definiteSafe.sort());
    expect(without.intersection).toHaveLength(0);
    expect(withFocus.intersection.length).toBeGreaterThan(0);
  });

  it('两个聚焦线索的重叠区域是它们共同的未知邻格', () => {
    const a: Position = { x: 1, y: 2, z: 2 };
    const b: Position = { x: 3, y: 2, z: 2 };
    const map = makeMap({ mines: [{ x: 2, y: 0, z: 0 }], explored: [a, b] });
    const result = analyze(map, [a, b]);
    const setA = new Set(result.clues[0]!.unknown);
    const setB = new Set(result.clues[1]!.unknown);
    const expected = [...setA].filter((i) => setB.has(i)).sort((m, n) => m - n);
    expect(result.intersection.slice().sort((m, n) => m - n)).toEqual(expected);
  });
});

describe('确定性推理', () => {
  it('数字为 0 时，未知邻格全部判定为安全', () => {
    const clue: Position = { x: 2, y: 2, z: 2 };
    const map = makeMap({ mines: [], explored: [clue] });
    const result = analyze(map, [clue]);
    expect(result.definiteMines).toHaveLength(0);
    for (const index of result.definiteSafe) {
      expect(result.cells.get(index)!.verdict).toBe('safe');
      expect(result.cells.get(index)!.probability).toBe(0);
    }
  });

  it('剩余雷数等于未知邻格数时全部判定为有雷', () => {
    const clue: Position = { x: 0, y: 0, z: 0 };
    const mines: Position[] = [];
    for (let dz = 0; dz <= 1; dz += 1) {
      for (let dy = 0; dy <= 1; dy += 1) {
        for (let dx = 0; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          mines.push({ x: dx, y: dy, z: dz });
        }
      }
    }
    // 起点换个位置，免得被雷包围影响 unknown 判定
    const map = makeMap({ mines, explored: [clue], start: { x: 4, y: 4, z: 0 } });
    const result = analyze(map, [clue]);
    expect(result.definiteMines).toHaveLength(7);
  });

  it('旗帜会被计入已标记雷数', () => {
    const clue: Position = { x: 2, y: 2, z: 2 };
    const mine: Position = { x: 3, y: 2, z: 2 };
    const map = makeMap({ mines: [mine], explored: [clue], flagged: [mine] });
    const result = analyze(map, [clue]);
    expect(result.clues[0]!.number).toBe(1);
    expect(result.clues[0]!.assumedMines).toBe(1);
    expect(result.clues[0]!.remaining).toBe(0);
    expect(result.definiteSafe.length).toBeGreaterThan(0);
  });

  it('已探索格、岩块、起点都不算未知邻格', () => {
    const clue: Position = { x: 1, y: 1, z: 1 };
    const rock: Position = { x: 2, y: 1, z: 1 };
    const exploredNeighbor: Position = { x: 0, y: 1, z: 1 };
    const map = makeMap({ rocks: [rock], explored: [clue, exploredNeighbor] });
    const unknown = new Set(analyze(map, [clue]).clues[0]!.unknown);
    expect(unknown.has(idx(rock))).toBe(false);
    expect(unknown.has(idx(exploredNeighbor))).toBe(false);
    expect(unknown.has(idx(START))).toBe(false);
  });

  it('子集规则：跨线索传播结论', () => {
    const line: Dims = { x: 7, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    const lineIdx = (p: Position) => positionToIndex(line, p);
    const map = makeMap({
      dims: line,
      mines: [at(2)],
      explored: [at(1), at(3), at(4)],
      start: at(0),
      end: at(6),
    });
    const result = analyze(map, []);
    expect(result.definiteMines).toContain(lineIdx(at(2)));
    expect(result.definiteSafe).toContain(lineIdx(at(5)));
  });
});

describe('全局雷数规则', () => {
  it('地雷已全部被标记时，其余未知格全部安全', () => {
    const line: Dims = { x: 6, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    const map = makeMap({
      dims: line,
      mines: [at(2)],
      explored: [at(1)],
      flagged: [at(2)],
      start: at(0),
      end: at(5),
    });
    const result = analyze(map, []);
    expect(result.remainingMines).toBe(0);
    // (3,0,0) 和 (4,0,0) 不在任何数字的邻域里，但总雷数已经用完
    expect(result.definiteSafe).toContain(positionToIndex(line, at(4)));
  });

  it('剩余雷数等于剩余未知格数时，未知格全部是雷', () => {
    const line: Dims = { x: 4, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    // 地图：起点(0) 终点(3)，雷在 1 和 2 —— 未知格恰好等于剩余雷数
    const map = makeMap({
      dims: line,
      mines: [at(1), at(2)],
      start: at(0),
      end: at(3),
    });
    const result = analyze(map, []);
    expect(result.remainingMines).toBe(2);
    expect(result.definiteMines.sort()).toEqual(
      [positionToIndex(line, at(1)), positionToIndex(line, at(2))].sort(),
    );
  });
});

describe('六邻域数字让推理变强', () => {
  const clue: Position = { x: 2, y: 2, z: 2 };

  it('关闭时用不到六邻域信息，开启后能推出更多结论', () => {
    // 六邻域内 0 颗雷，但 26 邻域内有 1 颗（斜向）
    const map = makeMap({ mines: [{ x: 1, y: 1, z: 1 }], explored: [clue] });
    const cell = map.cells[idx(clue)]!;
    expect(cell.adjacentMineCount).toBe(1);
    expect(cell.orthogonalMineCount).toBe(0);

    const without = analyze(map, [], { useOrthogonal: false });
    const withOrth = analyze(map, [], { useOrthogonal: true });

    // 关闭时「1 颗雷散在 26 格里」推不出任何确定结论
    expect(without.definiteSafe).toHaveLength(0);
    // 开启后六邻域数字为 0，六个正交邻格直接判定安全
    expect(withOrth.definiteSafe.length).toBeGreaterThanOrEqual(6);
    expect(withOrth.definiteSafe).toContain(idx({ x: 3, y: 2, z: 2 }));
  });

  it('六邻域约束数量随开关变化', () => {
    const map = makeMap({ explored: [clue] });
    const without = analyze(map, [], { useOrthogonal: false });
    const withOrth = analyze(map, [], { useOrthogonal: true });
    expect(withOrth.constraintCount).toBeGreaterThan(without.constraintCount);
  });
});

describe('精确概率', () => {
  it('单个约束下概率等于剩余雷数除以未知格数', () => {
    const line: Dims = { x: 9, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    // (4,0,0) 已探索，六邻域里恰好 1 颗雷，两个未知邻格各 50%
    const map = makeMap({
      dims: line,
      mines: [at(3)],
      explored: [at(4)],
      start: at(0),
      end: at(8),
    });
    const result = analyze(map, [], { useOrthogonal: true });
    const p3 = result.cells.get(positionToIndex(line, at(3)))!;
    const p5 = result.cells.get(positionToIndex(line, at(5)))!;
    expect(p3.verdict).toBe('unknown');
    expect(p3.probability).toBeCloseTo(0.5, 6);
    expect(p5.probability).toBeCloseTo(0.5, 6);
    expect(p3.exact).toBe(true);
    expect(result.exact).toBe(true);
  });

  it('概率始终落在 0~1，确定结论对应 0 或 1', () => {
    const map = makeMap({
      mines: [{ x: 2, y: 3, z: 2 }],
      explored: [
        { x: 1, y: 2, z: 2 },
        { x: 3, y: 2, z: 2 },
      ],
    });
    const result = analyze(map, []);
    for (const state of result.cells.values()) {
      expect(state.probability).toBeGreaterThanOrEqual(0);
      expect(state.probability).toBeLessThanOrEqual(1);
      if (state.verdict === 'mine') expect(state.probability).toBe(1);
      if (state.verdict === 'safe') expect(state.probability).toBe(0);
    }
  });

  it('枚举本身也能给出确定结论', () => {
    const line: Dims = { x: 5, y: 1, z: 1 };
    const at = (x: number): Position => ({ x, y: 0, z: 0 });
    // 起点(0) 终点(4)，雷在 2；(1,0,0) 与 (3,0,0) 已探索，六邻域数字各为 1
    const map = makeMap({
      dims: line,
      mines: [at(2)],
      explored: [at(1), at(3)],
      start: at(0),
      end: at(4),
    });
    const result = analyze(map, [], { useOrthogonal: true });
    expect(result.cells.get(positionToIndex(line, at(2)))!.verdict).toBe('mine');
  });
});

describe('健壮性', () => {
  it('旗帜数量超过数字时给出矛盾提示', () => {
    const clue: Position = { x: 2, y: 2, z: 2 };
    const map = makeMap({
      explored: [clue],
      flagged: [
        { x: 3, y: 2, z: 2 },
        { x: 1, y: 2, z: 2 },
      ],
    });
    const result = analyze(map, [clue]);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it('分析不会修改地图本身', () => {
    const map = makeMap({ mines: [{ x: 3, y: 2, z: 2 }], explored: [{ x: 2, y: 2, z: 2 }] });
    const snapshot = JSON.stringify(map.cells);
    analyze(map, [], { useOrthogonal: true });
    expect(JSON.stringify(map.cells)).toBe(snapshot);
  });

  it('没有任何已探索格时返回空结论而不是崩溃', () => {
    const map = createMapFromMines(DIMS, new Set(), START, END);
    // 连起点都标成未探索
    map.cells[idx(START)] = { ...map.cells[idx(START)]!, explored: false };
    const result = analyze(map, [], { player: { x: -1, y: -1, z: -1 } });
    expect(result.constraintCount).toBe(0);
    expect(result.definiteMines).toHaveLength(0);
  });

  it('大地图上也能在合理时间内跑完', () => {
    const dims: Dims = { x: 10, y: 10, z: 10 };
    const mines: Position[] = [];
    for (let i = 0; i < 120; i += 1) {
      mines.push({ x: i % 10, y: Math.floor(i / 10) % 10, z: (i * 3) % 10 });
    }
    const explored: Position[] = [];
    for (let x = 0; x < 10; x += 1) explored.push({ x, y: 5, z: 5 });
    const map = makeMap({
      dims,
      mines,
      explored,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 9, y: 9, z: 9 },
    });
    const started = Date.now();
    const result = analyze(map, [], { useOrthogonal: true });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.constraintCount).toBeGreaterThan(0);
  });
});
