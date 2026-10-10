import { describe, expect, it } from 'vitest';
import {
  countAdjacentMines,
  countOrthogonalMines,
  inBounds,
  indexToPosition,
  manhattan,
  positionToIndex,
  sixNeighbors,
  twentySixNeighbors,
} from '../game/neighbors';
import { totalCells } from '../game/constants';
import type { Dims, Position } from '../game/types';

const SIZE: Dims = { x: 5, y: 5, z: 5 };

describe('索引与坐标互转', () => {
  it('positionToIndex 与 indexToPosition 互为逆运算', () => {
    for (let index = 0; index < totalCells(SIZE); index += 1) {
      const p = indexToPosition(SIZE, index);
      expect(positionToIndex(SIZE, p)).toBe(index);
    }
  });

  it('inBounds 能正确识别地图外坐标', () => {
    expect(inBounds(SIZE, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(inBounds(SIZE, { x: 4, y: 4, z: 4 })).toBe(true);
    expect(inBounds(SIZE, { x: -1, y: 0, z: 0 })).toBe(false);
    expect(inBounds(SIZE, { x: 0, y: 5, z: 0 })).toBe(false);
    expect(inBounds(SIZE, { x: 0, y: 0, z: 5 })).toBe(false);
  });
});

describe('非立方体地图', () => {
  const FLAT: Dims = { x: 8, y: 3, z: 5 };

  it('索引换算在三维尺寸不同时依然可逆', () => {
    for (let index = 0; index < totalCells(FLAT); index += 1) {
      expect(positionToIndex(FLAT, indexToPosition(FLAT, index))).toBe(index);
    }
  });

  it('每个轴独立判定边界', () => {
    expect(inBounds(FLAT, { x: 7, y: 2, z: 4 })).toBe(true);
    expect(inBounds(FLAT, { x: 8, y: 2, z: 4 })).toBe(false);
    expect(inBounds(FLAT, { x: 7, y: 3, z: 4 })).toBe(false);
    expect(inBounds(FLAT, { x: 7, y: 2, z: 5 })).toBe(false);
  });

  it('薄轴上的格子邻居数量正确：y 只有 3 层时中间格仍有完整的 26 邻域', () => {
    expect(twentySixNeighbors(FLAT, { x: 4, y: 1, z: 2 })).toHaveLength(26);
    // y = 0 是边界面，少掉一整层 9 个
    expect(twentySixNeighbors(FLAT, { x: 4, y: 0, z: 2 })).toHaveLength(17);
    expect(sixNeighbors(FLAT, { x: 4, y: 0, z: 2 })).toHaveLength(5);
  });
});

describe('26 邻域探测邻居', () => {
  it('内部格有 26 个探测邻居', () => {
    expect(twentySixNeighbors(SIZE, { x: 2, y: 2, z: 2 })).toHaveLength(26);
  });

  it('面心格有 17 个探测邻居', () => {
    expect(twentySixNeighbors(SIZE, { x: 0, y: 2, z: 2 })).toHaveLength(17);
  });

  it('棱上格有 11 个探测邻居', () => {
    expect(twentySixNeighbors(SIZE, { x: 0, y: 0, z: 2 })).toHaveLength(11);
  });

  it('角落格只有 7 个探测邻居', () => {
    expect(twentySixNeighbors(SIZE, { x: 0, y: 0, z: 0 })).toHaveLength(7);
    expect(twentySixNeighbors(SIZE, { x: 4, y: 4, z: 4 })).toHaveLength(7);
  });

  it('不会返回自身，也不会返回地图外坐标', () => {
    const origin: Position = { x: 0, y: 3, z: 4 };
    const neighbors = twentySixNeighbors(SIZE, origin);
    for (const n of neighbors) {
      expect(inBounds(SIZE, n)).toBe(true);
      expect(`${n.x},${n.y},${n.z}`).not.toBe(`${origin.x},${origin.y},${origin.z}`);
    }
    // 无重复
    expect(new Set(neighbors.map((n) => positionToIndex(SIZE, n))).size).toBe(neighbors.length);
  });
});

describe('六方向移动邻居', () => {
  it('内部格 6 个，面上 5 个，棱上 4 个，角上 3 个', () => {
    expect(sixNeighbors(SIZE, { x: 2, y: 2, z: 2 })).toHaveLength(6);
    expect(sixNeighbors(SIZE, { x: 0, y: 2, z: 2 })).toHaveLength(5);
    expect(sixNeighbors(SIZE, { x: 0, y: 0, z: 2 })).toHaveLength(4);
    expect(sixNeighbors(SIZE, { x: 0, y: 0, z: 0 })).toHaveLength(3);
  });

  it('六方向邻居均为正交移动，且不会越界', () => {
    const origin: Position = { x: 1, y: 1, z: 1 };
    for (const n of sixNeighbors(SIZE, origin)) {
      expect(inBounds(SIZE, n)).toBe(true);
      expect(manhattan(origin, n)).toBe(1);
    }
  });
});

describe('26 邻域地雷计数', () => {
  const mineAt = (...positions: Position[]) =>
    new Set(positions.map((p) => positionToIndex(SIZE, p)));

  it('能正确统计 26 邻域内的地雷', () => {
    const mines = mineAt({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 }, { x: 2, y: 3, z: 2 });
    expect(countAdjacentMines(SIZE, { x: 2, y: 2, z: 2 }, mines)).toBe(3);
  });

  it('不会统计当前格自身', () => {
    const mines = mineAt({ x: 2, y: 2, z: 2 });
    expect(countAdjacentMines(SIZE, { x: 2, y: 2, z: 2 }, mines)).toBe(0);
  });

  it('斜向之外（切比雪夫距离 > 1）的地雷不计入', () => {
    const mines = mineAt({ x: 4, y: 2, z: 2 });
    expect(countAdjacentMines(SIZE, { x: 2, y: 2, z: 2 }, mines)).toBe(0);
  });

  it('边界格只统计地图内的邻格', () => {
    const mines = mineAt({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(countAdjacentMines(SIZE, { x: 0, y: 0, z: 0 }, mines)).toBe(3);
  });

  it('六邻域雷数只统计 6 个正交邻格，取值 0~6', () => {
    const center: Position = { x: 2, y: 2, z: 2 };
    // 斜向邻格是雷，但不在六邻域内
    const diagonal = new Set([positionToIndex(SIZE, { x: 1, y: 1, z: 1 })]);
    expect(countOrthogonalMines(SIZE, center, diagonal)).toBe(0);
    expect(countAdjacentMines(SIZE, center, diagonal)).toBe(1);

    const orthogonal = new Set(
      sixNeighbors(SIZE, center).map((p) => positionToIndex(SIZE, p)),
    );
    expect(countOrthogonalMines(SIZE, center, orthogonal)).toBe(6);
  });

  it('角落格的六邻域最多只有 3 个', () => {
    const corner: Position = { x: 0, y: 0, z: 0 };
    const all = new Set(
      Array.from({ length: totalCells(SIZE) }, (_, i) => i),
    );
    expect(countOrthogonalMines(SIZE, corner, all)).toBe(3);
  });

  it('全部 26 个邻格都是雷时结果为 26', () => {
    const center: Position = { x: 2, y: 2, z: 2 };
    const mines = new Set(twentySixNeighbors(SIZE, center).map((p) => positionToIndex(SIZE, p)));
    expect(countAdjacentMines(SIZE, center, mines)).toBe(26);
  });
});
