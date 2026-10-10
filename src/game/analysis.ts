import { positionToIndex, samePosition, sixNeighbors, twentySixNeighbors } from './neighbors';
import type { Cell, GameMap, Position } from './types';

/**
 * 扫雷推理引擎。
 *
 * 它只做一件事：把玩家**已经拥有**的信息推到底。不读取任何玩家尚未获得的信息，
 * 也不替玩家走棋。约束来自已探索格的数字、玩家自己插的旗帜、已揭示的地雷、
 * 地形（岩块）以及 HUD 上本来就显示的地雷总数。
 *
 * 分两步：
 * 1. **确定性推理**：基本规则 + 子集规则 + 全局雷数规则，迭代到不动点；
 * 2. **精确概率**：把约束按共享格子分成连通分量，在每个分量内回溯枚举所有合法布雷方案，
 *    再用「剩余雷数分配到分量外未知格」的组合数加权，得到精确的边缘概率。
 *    分量太大时退回局部估计，并在结果里标明 exact = false。
 */

export type Verdict = 'mine' | 'safe' | 'unknown';

/** 单个格子的数字所提供的一条约束：这些未知格里恰好有 mines 颗雷 */
export interface Constraint {
  origin: Position;
  originIndex: number;
  cells: number[];
  mines: number;
  /** wide = 26 邻域；orth = 六邻域（更细，仅在难度开启时可用） */
  kind: 'wide' | 'orth';
}

export interface ClueInfo {
  position: Position;
  index: number;
  number: number;
  /** 邻域中已经被认定为雷的数量（玩家旗帜 + 已揭示地雷） */
  assumedMines: number;
  /** 还需要在未知邻格中找出的雷数 */
  remaining: number;
  unknown: number[];
}

export interface AnalysisCellState {
  verdict: Verdict;
  /** 含雷概率 0~1 */
  probability: number;
  /** 该格的概率是精确枚举得到的，而不是估计 */
  exact: boolean;
  /** 该格本身是被聚焦的线索格 */
  isClue: boolean;
  /** 该格落在所有聚焦线索邻域的交集里 */
  inIntersection: boolean;
}

export interface AnalysisResult {
  /** 被聚焦的线索格（只影响高亮，不影响推理范围） */
  clues: ClueInfo[];
  intersection: number[];
  union: number[];
  cells: Map<number, AnalysisCellState>;
  definiteMines: number[];
  definiteSafe: number[];
  contradictions: string[];
  /** 参与推理的约束条数 */
  constraintCount: number;
  /** 仍然未知的格子总数 */
  unknownCount: number;
  /** 还没找到的地雷数（地雷总数 − 已插旗 − 已揭示） */
  remainingMines: number;
  /** 所有概率是否都是精确枚举得到的 */
  exact: boolean;
}

export const EMPTY_ANALYSIS: AnalysisResult = {
  clues: [],
  intersection: [],
  union: [],
  cells: new Map(),
  definiteMines: [],
  definiteSafe: [],
  contradictions: [],
  constraintCount: 0,
  unknownCount: 0,
  remainingMines: 0,
  exact: true,
};

/** 单个连通分量最多枚举多少格；超过就退回估计 */
const MAX_COMPONENT_CELLS = 26;
/** 回溯搜索的节点预算，防止极端局面卡住界面 */
const NODE_BUDGET = 400_000;

/** 该格的数字是否已经对玩家可见（可以作为约束来源） */
export function isClueCandidate(cell: Cell, player: Position): boolean {
  return cell.explored || samePosition(cell.position, player);
}

function isAssumedMine(cell: Cell): boolean {
  return cell.revealedMine || cell.mark === 'flag';
}

/**
 * 某个格子对推理而言是否「未知」。
 * 已探索格、岩块、已揭示地雷、旗帜、起点都不算；终点只有在玩家知道它位置时才算已知安全。
 */
function isUnknownCell(cell: Cell, map: GameMap, endKnown: boolean): boolean {
  // 问号只是「拿不准」，不构成任何断言，因此仍然算未知格
  if (cell.explored || cell.mark === 'flag' || cell.revealedMine) return false;
  if (cell.type === 'rock') return false;
  if (samePosition(cell.position, map.start)) return false;
  if (endKnown && samePosition(cell.position, map.end)) return false;
  return true;
}

// ---------------------------------------------------------------- 组合数 ---

const logFactorials: number[] = [0];

function logFactorial(n: number): number {
  while (logFactorials.length <= n) {
    logFactorials.push(logFactorials[logFactorials.length - 1]! + Math.log(logFactorials.length));
  }
  return logFactorials[n]!;
}

/** log C(n, k)；越界返回 -Infinity（权重为 0） */
function logChoose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** 多项式卷积：把两个「按雷数分布的方案数」合并 */
function convolve(a: number[], b: number[]): number[] {
  const result = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j += 1) {
      if (b[j] === 0) continue;
      result[i + j] += a[i]! * b[j]!;
    }
  }
  return result;
}

// ------------------------------------------------------------ 约束的构建 ---

function buildConstraints(
  map: GameMap,
  endKnown: boolean,
  useOrthogonal: boolean,
  player: Position,
): { constraints: Constraint[]; unknown: Set<number> } {
  const constraints: Constraint[] = [];
  const unknown = new Set<number>();

  for (let index = 0; index < map.cells.length; index += 1) {
    const cell = map.cells[index]!;
    if (isUnknownCell(cell, map, endKnown)) unknown.add(index);
  }

  const collect = (origin: Position, neighbors: Position[], total: number, kind: 'wide' | 'orth') => {
    let assumed = 0;
    const cells: number[] = [];
    for (const neighbor of neighbors) {
      const neighborIndex = positionToIndex(map.dims, neighbor);
      const neighborCell = map.cells[neighborIndex]!;
      if (isAssumedMine(neighborCell)) assumed += 1;
      else if (unknown.has(neighborIndex)) cells.push(neighborIndex);
    }
    if (cells.length === 0) return;
    constraints.push({
      origin,
      originIndex: positionToIndex(map.dims, origin),
      cells,
      mines: total - assumed,
      kind,
    });
  };

  for (const cell of map.cells) {
    if (!isClueCandidate(cell, player)) continue;
    collect(cell.position, twentySixNeighbors(map.dims, cell.position), cell.adjacentMineCount, 'wide');
    // 六邻域数字是可选规则：难度没开启时玩家看不到，推理也不能用
    if (useOrthogonal) {
      collect(cell.position, sixNeighbors(map.dims, cell.position), cell.orthogonalMineCount, 'orth');
    }
  }

  return { constraints, unknown };
}

// -------------------------------------------------------------- 确定性推理 ---

interface WorkingConstraint {
  cells: Set<number>;
  mines: number;
  source: Constraint;
}

function isSubset(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size > b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * 基本规则 + 子集规则 + 全局雷数规则，迭代到不动点。
 * 子集规则只在共享格子的约束对之间检查，避免 O(n²) 全量比较。
 */
function deduce(
  working: WorkingConstraint[],
  unknown: Set<number>,
  remainingMines: number,
  verdicts: Map<number, Exclude<Verdict, 'unknown'>>,
  contradictions: string[],
): void {
  const cellToConstraints = new Map<number, WorkingConstraint[]>();
  for (const entry of working) {
    for (const cell of entry.cells) {
      const list = cellToConstraints.get(cell);
      if (list) list.push(entry);
      else cellToConstraints.set(cell, [entry]);
    }
  }

  let mineBudget = remainingMines;
  let freeCells = unknown.size;

  const assign = (index: number, verdict: Exclude<Verdict, 'unknown'>): boolean => {
    const existing = verdicts.get(index);
    if (existing === verdict) return false;
    if (existing) {
      contradictions.push('同一个格子被推出互相矛盾的结论，请检查旗帜是否插错');
      return false;
    }
    verdicts.set(index, verdict);
    freeCells -= 1;
    if (verdict === 'mine') mineBudget -= 1;
    for (const entry of cellToConstraints.get(index) ?? []) {
      if (!entry.cells.delete(index)) continue;
      if (verdict === 'mine') entry.mines -= 1;
    }
    return true;
  };

  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;

    // 规则 1：基本规则
    for (const entry of working) {
      if (entry.cells.size === 0) continue;
      if (entry.mines === 0) {
        for (const index of [...entry.cells]) changed = assign(index, 'safe') || changed;
      } else if (entry.mines === entry.cells.size) {
        for (const index of [...entry.cells]) changed = assign(index, 'mine') || changed;
      }
    }

    // 规则 2：子集规则（只比较共享格子的约束对）
    for (const a of working) {
      if (a.cells.size === 0) continue;
      const candidates = new Set<WorkingConstraint>();
      for (const cell of a.cells) {
        for (const other of cellToConstraints.get(cell) ?? []) {
          if (other !== a && other.cells.size > a.cells.size) candidates.add(other);
        }
      }
      for (const b of candidates) {
        if (!isSubset(a.cells, b.cells)) continue;
        const diff = [...b.cells].filter((index) => !a.cells.has(index));
        if (diff.length === 0) continue;
        const diffMines = b.mines - a.mines;
        if (diffMines === 0) {
          for (const index of diff) changed = assign(index, 'safe') || changed;
        } else if (diffMines === diff.length) {
          for (const index of diff) changed = assign(index, 'mine') || changed;
        }
      }
    }

    // 规则 3：全局雷数规则（HUD 上的地雷总数本来就是公开信息）
    if (freeCells > 0) {
      if (mineBudget === 0) {
        for (const index of unknown) {
          if (!verdicts.has(index)) changed = assign(index, 'safe') || changed;
        }
      } else if (mineBudget === freeCells) {
        for (const index of unknown) {
          if (!verdicts.has(index)) changed = assign(index, 'mine') || changed;
        }
      }
    }

    if (!changed) break;
  }

  // 矛盾检测
  for (const entry of working) {
    const p = entry.source.origin;
    const name = entry.source.kind === 'orth' ? '六邻域' : '26 邻域';
    if (entry.mines < 0) {
      contradictions.push(`(${p.x}, ${p.y}, ${p.z}) 的${name}旗帜数量超过了它的数字`);
    } else if (entry.mines > entry.cells.size) {
      contradictions.push(
        `(${p.x}, ${p.y}, ${p.z}) 的${name}还需要 ${entry.mines} 颗雷，但周围已经没有那么多未知格了`,
      );
    }
  }
  if (mineBudget < 0) contradictions.push('已标记的地雷数量超过了地图上的地雷总数');
}

// ------------------------------------------------------------ 精确概率枚举 ---

interface ComponentResult {
  cells: number[];
  /** ways[k] = 该分量内恰好放 k 颗雷的合法方案数 */
  ways: number[];
  /** mineWays[i][k] = 第 i 个格子是雷、且分量内共 k 颗雷的方案数 */
  mineWays: number[][];
  exact: boolean;
}

/** 把约束按共享格子分成连通分量 */
function splitComponents(working: WorkingConstraint[]): {
  cells: number[];
  constraints: WorkingConstraint[];
}[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = x;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const entry of working) {
    for (const cell of entry.cells) if (!parent.has(cell)) parent.set(cell, cell);
  }
  for (const entry of working) {
    const cells = [...entry.cells];
    for (let i = 1; i < cells.length; i += 1) union(cells[0]!, cells[i]!);
  }

  const groups = new Map<number, { cells: number[]; constraints: WorkingConstraint[] }>();
  for (const cell of parent.keys()) {
    const root = find(cell);
    let group = groups.get(root);
    if (!group) {
      group = { cells: [], constraints: [] };
      groups.set(root, group);
    }
    group.cells.push(cell);
  }
  for (const entry of working) {
    if (entry.cells.size === 0) continue;
    const root = find([...entry.cells][0]!);
    groups.get(root)!.constraints.push(entry);
  }
  return [...groups.values()];
}

/**
 * 在一个连通分量内回溯枚举所有满足约束的布雷方案。
 * 节点预算用尽或分量过大时返回 exact: false，由调用方退回估计。
 */
function enumerateComponent(component: {
  cells: number[];
  constraints: WorkingConstraint[];
}): ComponentResult {
  const cells = component.cells;
  const n = cells.length;
  const empty: ComponentResult = {
    cells,
    ways: [],
    mineWays: cells.map(() => []),
    exact: false,
  };
  if (n === 0) return { ...empty, ways: [1], exact: true };
  if (n > MAX_COMPONENT_CELLS) return empty;

  const localIndex = new Map<number, number>();
  cells.forEach((cell, i) => localIndex.set(cell, i));

  // 每条约束在本分量内的局部格子列表
  const constraints = component.constraints.map((entry) => ({
    cells: [...entry.cells].map((cell) => localIndex.get(cell)!),
    mines: entry.mines,
  }));

  // 每个格子属于哪些约束
  const cellConstraints: number[][] = cells.map(() => []);
  constraints.forEach((constraint, ci) => {
    for (const local of constraint.cells) cellConstraints[local]!.push(ci);
  });

  // 变量顺序：优先安排出现在最多约束里的格子，剪枝更早生效
  const order = cells
    .map((_, i) => i)
    .sort((a, b) => cellConstraints[b]!.length - cellConstraints[a]!.length);

  const assignedMines = new Array<number>(constraints.length).fill(0);
  const remainingCells = constraints.map((c) => c.cells.length);
  const state = new Int8Array(n).fill(-1);

  const ways: number[] = [];
  const mineWays: number[][] = cells.map(() => []);
  let nodes = 0;
  let aborted = false;

  const record = (mineCount: number) => {
    ways[mineCount] = (ways[mineCount] ?? 0) + 1;
    for (let i = 0; i < n; i += 1) {
      if (state[i] === 1) mineWays[i]![mineCount] = (mineWays[i]![mineCount] ?? 0) + 1;
    }
  };

  const step = (depth: number, mineCount: number): void => {
    if (aborted) return;
    nodes += 1;
    if (nodes > NODE_BUDGET) {
      aborted = true;
      return;
    }
    if (depth === n) {
      record(mineCount);
      return;
    }

    const local = order[depth]!;
    for (const value of [0, 1] as const) {
      let ok = true;
      const touched = cellConstraints[local]!;
      for (const ci of touched) {
        const next = assignedMines[ci]! + value;
        const left = remainingCells[ci]! - 1;
        if (next > constraints[ci]!.mines || next + left < constraints[ci]!.mines) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      state[local] = value;
      for (const ci of touched) {
        assignedMines[ci] += value;
        remainingCells[ci] -= 1;
      }
      step(depth + 1, mineCount + value);
      for (const ci of touched) {
        assignedMines[ci] -= value;
        remainingCells[ci] += 1;
      }
      state[local] = -1;
      if (aborted) return;
    }
  };

  step(0, 0);
  if (aborted) return empty;

  const maxK = ways.length;
  for (let k = 0; k < maxK; k += 1) if (ways[k] === undefined) ways[k] = 0;
  for (const row of mineWays) {
    for (let k = 0; k < maxK; k += 1) if (row[k] === undefined) row[k] = 0;
  }
  return { cells, ways, mineWays, exact: true };
}

// ------------------------------------------------------------------ 主入口 ---

export interface AnalyzeOptions {
  /** 玩家是否知道终点位置（隐藏终点时推理不能利用「终点必定安全」） */
  endKnown?: boolean;
  /** 难度是否开启了六邻域数字 */
  useOrthogonal?: boolean;
  /** 玩家位置（用于把玩家所在格也当作线索来源） */
  player?: Position;
}

export function analyze(
  map: GameMap,
  focusClues: readonly Position[] = [],
  options: AnalyzeOptions = {},
): AnalysisResult {
  const endKnown = options.endKnown ?? true;
  const useOrthogonal = options.useOrthogonal ?? false;
  const player = options.player ?? map.start;

  const { constraints, unknown } = buildConstraints(map, endKnown, useOrthogonal, player);

  let assumedMines = 0;
  for (const cell of map.cells) if (isAssumedMine(cell)) assumedMines += 1;
  const remainingMines = map.mineCount - assumedMines;

  const contradictions: string[] = [];
  const verdicts = new Map<number, Exclude<Verdict, 'unknown'>>();
  const working: WorkingConstraint[] = constraints.map((source) => ({
    cells: new Set(source.cells),
    mines: source.mines,
    source,
  }));

  deduce(working, unknown, remainingMines, verdicts, contradictions);

  // ---- 概率：分量枚举 + 全局雷数加权 ----
  const probability = new Map<number, number>();
  const exactCells = new Set<number>();

  const live = working.filter((entry) => entry.cells.size > 0);
  const components = splitComponents(live);
  const results = components.map(enumerateComponent);

  // 分量外的未知格（"海"）：不受任何数字约束，只受总雷数约束
  const constrainedCells = new Set<number>();
  for (const result of results) for (const cell of result.cells) constrainedCells.add(cell);
  let seaSize = 0;
  for (const index of unknown) {
    if (!verdicts.has(index) && !constrainedCells.has(index)) seaSize += 1;
  }
  const decidedMines = [...verdicts.values()].filter((v) => v === 'mine').length;
  const budget = remainingMines - decidedMines;

  const exactResults = results.filter((r) => r.exact);
  const allExact = results.length === exactResults.length;

  if (exactResults.length > 0 && budget >= 0) {
    // 前缀 / 后缀卷积，用于快速求出"除某个分量外其余分量"的雷数分布
    const distributions = exactResults.map((r) => r.ways);
    const prefix: number[][] = [[1]];
    for (let i = 0; i < distributions.length; i += 1) {
      prefix.push(convolve(prefix[i]!, distributions[i]!));
    }
    const suffix: number[][] = new Array(distributions.length + 1);
    suffix[distributions.length] = [1];
    for (let i = distributions.length - 1; i >= 0; i -= 1) {
      suffix[i] = convolve(distributions[i]!, suffix[i + 1]!);
    }

    // 海里放 r 颗雷的组合数（对数），用最大值归一化避免溢出
    const seaLog = (r: number) => logChoose(seaSize, r);

    for (let ci = 0; ci < exactResults.length; ci += 1) {
      const result = exactResults[ci]!;
      const others = convolve(prefix[ci]!, suffix[ci + 1]!);

      // tail[k] = Σ_others others[ko] * C(sea, budget - k - ko)
      const tail: number[] = new Array(result.ways.length).fill(0);
      const terms: { k: number; log: number; weight: number }[] = [];
      for (let k = 0; k < result.ways.length; k += 1) {
        for (let ko = 0; ko < others.length; ko += 1) {
          if (others[ko] === 0) continue;
          const log = seaLog(budget - k - ko);
          if (log === Number.NEGATIVE_INFINITY) continue;
          terms.push({ k, log, weight: others[ko]! });
        }
      }
      if (terms.length === 0) continue;
      const maxLog = Math.max(...terms.map((t) => t.log));
      for (const term of terms) {
        tail[term.k]! += term.weight * Math.exp(term.log - maxLog);
      }

      let total = 0;
      for (let k = 0; k < result.ways.length; k += 1) total += result.ways[k]! * tail[k]!;
      if (total <= 0) continue;

      result.cells.forEach((cell, i) => {
        let mineTotal = 0;
        const row = result.mineWays[i]!;
        for (let k = 0; k < row.length; k += 1) mineTotal += row[k]! * (tail[k] ?? 0);
        const p = Math.max(0, Math.min(1, mineTotal / total));
        probability.set(cell, p);
        exactCells.add(cell);
        // 枚举本身也能给出确定结论，比规则更强
        if (p <= 1e-9 && !verdicts.has(cell)) verdicts.set(cell, 'safe');
        else if (p >= 1 - 1e-9 && !verdicts.has(cell)) verdicts.set(cell, 'mine');
      });
    }

    // 海里的格子：剩余雷数均匀分布
    if (seaSize > 0) {
      let expectedInSea = budget;
      for (const result of exactResults) {
        let mean = 0;
        let totalWays = 0;
        for (let k = 0; k < result.ways.length; k += 1) {
          mean += k * result.ways[k]!;
          totalWays += result.ways[k]!;
        }
        if (totalWays > 0) expectedInSea -= mean / totalWays;
      }
      const seaProbability = Math.max(0, Math.min(1, expectedInSea / seaSize));
      for (const index of unknown) {
        if (verdicts.has(index) || constrainedCells.has(index)) continue;
        probability.set(index, seaProbability);
      }
    }
  }

  // 无法枚举的分量退回局部估计
  for (const result of results) {
    if (result.exact) continue;
    for (const entry of live) {
      if (entry.cells.size === 0) continue;
      const local = entry.mines / entry.cells.size;
      for (const cell of entry.cells) {
        if (exactCells.has(cell)) continue;
        probability.set(cell, Math.max(probability.get(cell) ?? 0, Math.max(0, Math.min(1, local))));
      }
    }
    break;
  }

  // ---- 聚焦线索（只影响高亮） ----
  const focusIndices = new Set<number>();
  const clues: ClueInfo[] = [];
  for (const position of focusClues) {
    const index = positionToIndex(map.dims, position);
    if (focusIndices.has(index)) continue;
    const cell = map.cells[index];
    if (!cell) continue;
    focusIndices.add(index);
    const source = constraints.find((c) => c.originIndex === index && c.kind === 'wide');
    const cells = source ? source.cells : [];
    clues.push({
      position,
      index,
      number: cell.adjacentMineCount,
      assumedMines: cell.adjacentMineCount - (source?.mines ?? cell.adjacentMineCount),
      remaining: source?.mines ?? 0,
      unknown: cells,
    });
  }

  const union = new Set<number>();
  let intersection: Set<number> | null = null;
  for (const clue of clues) {
    const current = new Set(clue.unknown);
    for (const index of current) union.add(index);
    if (intersection === null) intersection = current;
    else for (const index of [...intersection]) if (!current.has(index)) intersection.delete(index);
  }
  const intersectionSet = intersection ?? new Set<number>();

  // ---- 汇总 ----
  const cells = new Map<number, AnalysisCellState>();
  const touched = new Set<number>([
    ...probability.keys(),
    ...verdicts.keys(),
    ...union,
    ...focusIndices,
  ]);
  for (const index of touched) {
    const verdict = verdicts.get(index) ?? 'unknown';
    cells.set(index, {
      verdict,
      probability:
        verdict === 'mine' ? 1 : verdict === 'safe' ? 0 : (probability.get(index) ?? 0),
      exact: verdict !== 'unknown' || exactCells.has(index),
      isClue: focusIndices.has(index),
      inIntersection: intersectionSet.has(index),
    });
  }

  return {
    clues,
    intersection: [...intersectionSet],
    union: [...union],
    cells,
    definiteMines: [...verdicts.entries()].filter(([, v]) => v === 'mine').map(([i]) => i),
    definiteSafe: [...verdicts.entries()].filter(([, v]) => v === 'safe').map(([i]) => i),
    contradictions: [...new Set(contradictions)],
    constraintCount: constraints.length,
    unknownCount: unknown.size,
    remainingMines,
    exact: allExact,
  };
}

/** 查询某个格子的推理结论，未被推理覆盖时返回 unknown */
export function verdictAt(result: AnalysisResult, index: number): AnalysisCellState | null {
  return result.cells.get(index) ?? null;
}
