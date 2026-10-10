import type { CellVisualKind } from '../game/selectors';

/** 格子使用的几何形状：靠轮廓区分状态，比单纯换颜色可读得多 */
export type CellShape = 'box' | 'cone' | 'spiky';

export interface CellStyle {
  color: string;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  edgeColor: string;
  edgeOpacity: number;
  /** 方块在格内的相对大小，0~1 */
  scale: number;
  shape: CellShape;
}

/**
 * 每种格子状态的视觉定义。
 *
 * 三维体积里颜色是最弱的通道 —— 半透明方块层层叠加后色相会互相污染。
 * 所以这里把**大小和形状**当作主要区分手段：
 * 未探索格缩到很小（既容易辨认，也大幅减少遮挡），旗帜是锥体，地雷是多面体，
 * 岩块是唯一填满整格的不透明方块。颜色和图标只作为辅助。
 */
export const CELL_STYLES: Record<CellVisualKind, CellStyle> = {
  player: {
    color: '#22d3ee',
    opacity: 0.9,
    emissive: '#22d3ee',
    emissiveIntensity: 0.85,
    edgeColor: '#ecfeff',
    edgeOpacity: 1,
    scale: 0.92,
    shape: 'box',
  },
  mine: {
    color: '#f97316',
    opacity: 0.92,
    emissive: '#7c2d12',
    emissiveIntensity: 0.6,
    edgeColor: '#fed7aa',
    edgeOpacity: 0.95,
    scale: 0.82,
    shape: 'spiky',
  },
  'flag-correct': {
    // 标对的旗：绿色锥体 + 对勾
    color: '#22c55e',
    opacity: 0.92,
    emissive: '#14532d',
    emissiveIntensity: 0.55,
    edgeColor: '#bbf7d0',
    edgeOpacity: 1,
    scale: 0.9,
    shape: 'cone',
  },
  'flag-wrong': {
    // 标错的旗：红色锥体 + 叉
    color: '#ef4444',
    opacity: 0.92,
    emissive: '#7f1d1d',
    emissiveIntensity: 0.55,
    edgeColor: '#fecaca',
    edgeOpacity: 1,
    scale: 0.9,
    shape: 'cone',
  },
  rock: {
    // 岩块是完全不透明的实心地形，填满整格，与所有半透明格子形成绝对区分
    color: '#57534e',
    opacity: 1,
    emissive: '#1c1917',
    emissiveIntensity: 0.15,
    edgeColor: '#d6d3d1',
    edgeOpacity: 0.85,
    scale: 1,
    shape: 'box',
  },
  start: {
    color: '#34d399',
    opacity: 0.5,
    emissive: '#065f46',
    emissiveIntensity: 0.35,
    edgeColor: '#a7f3d0',
    edgeOpacity: 0.95,
    scale: 0.86,
    shape: 'box',
  },
  end: {
    color: '#fbbf24',
    opacity: 0.72,
    emissive: '#b45309',
    emissiveIntensity: 0.8,
    edgeColor: '#fef3c7',
    edgeOpacity: 1,
    scale: 0.88,
    shape: 'box',
  },
  flag: {
    color: '#a78bfa',
    opacity: 0.75,
    emissive: '#4c1d95',
    emissiveIntensity: 0.35,
    edgeColor: '#ddd6fe',
    edgeOpacity: 1,
    scale: 0.86,
    shape: 'cone',
  },
  unsure: {
    // 问号是比旗帜更弱的断言，所以视觉上也更弱：方块（不是锥体）、更小、更灰
    color: '#8b7fb8',
    opacity: 0.6,
    emissive: '#3b1f6b',
    emissiveIntensity: 0.25,
    edgeColor: '#c4b5fd',
    edgeOpacity: 0.85,
    scale: 0.72,
    shape: 'box',
  },
  explored: {
    color: '#3b82f6',
    opacity: 0.3,
    emissive: '#1e3a8a',
    emissiveIntensity: 0.15,
    edgeColor: '#93c5fd',
    edgeOpacity: 0.7,
    scale: 0.66,
    shape: 'box',
  },
  unknown: {
    // 缩得很小：既是"信息量最少"的视觉表达，也让立方体内部一下子通透起来
    color: '#64748b',
    opacity: 0.34,
    emissive: '#000000',
    emissiveIntensity: 0,
    edgeColor: '#94a3b8',
    edgeOpacity: 0.45,
    scale: 0.34,
    shape: 'box',
  },
};

/** 不在当前切片层的格子：大幅降低不透明度，只保留空间参考作用 */
export const OUT_OF_SLICE_FACTOR = 0.1;

export const SCENE_BACKGROUND = '#060910';

/** 图例中使用的 CSS 颜色，与 3D 中保持一致 */
export const LEGEND_COLORS: Record<CellVisualKind, string> = {
  player: CELL_STYLES.player.color,
  mine: CELL_STYLES.mine.color,
  'flag-correct': CELL_STYLES['flag-correct'].color,
  'flag-wrong': CELL_STYLES['flag-wrong'].color,
  rock: CELL_STYLES.rock.color,
  start: CELL_STYLES.start.color,
  end: CELL_STYLES.end.color,
  flag: CELL_STYLES.flag.color,
  unsure: CELL_STYLES.unsure.color,
  explored: CELL_STYLES.explored.color,
  unknown: '#94a3b8',
};
