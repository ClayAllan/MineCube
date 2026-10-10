import * as THREE from 'three';

/**
 * 共享的几何体与材质缓存。
 * 512 个格子共用同一份 BoxGeometry / EdgesGeometry，材质按「颜色 + 透明度」缓存，
 * 避免每帧或每次渲染创建新的 Three.js 对象。
 */

export const CELL_BOX_GEOMETRY = new THREE.BoxGeometry(0.84, 0.84, 0.84);

/** 旗帜用四棱锥：轮廓和方块完全不同，远处一眼可辨 */
export const CELL_CONE_GEOMETRY = new THREE.ConeGeometry(0.5, 0.86, 4);
/** 地雷用二十面体：棱角分明的"球"，与方块和锥体都不会混淆 */
export const CELL_SPIKY_GEOMETRY = new THREE.IcosahedronGeometry(0.5, 0);

const edgeSource = new THREE.BoxGeometry(0.86, 0.86, 0.86);
export const CELL_EDGE_GEOMETRY = new THREE.EdgesGeometry(edgeSource);
edgeSource.dispose();

export const CELL_CONE_EDGE_GEOMETRY = new THREE.EdgesGeometry(CELL_CONE_GEOMETRY);
export const CELL_SPIKY_EDGE_GEOMETRY = new THREE.EdgesGeometry(CELL_SPIKY_GEOMETRY);

/** 按形状取几何体 */
export function getShapeGeometry(shape: 'box' | 'cone' | 'spiky'): THREE.BufferGeometry {
  if (shape === 'cone') return CELL_CONE_GEOMETRY;
  if (shape === 'spiky') return CELL_SPIKY_GEOMETRY;
  return CELL_BOX_GEOMETRY;
}

export function getShapeEdgeGeometry(shape: 'box' | 'cone' | 'spiky'): THREE.BufferGeometry {
  if (shape === 'cone') return CELL_CONE_EDGE_GEOMETRY;
  if (shape === 'spiky') return CELL_SPIKY_EDGE_GEOMETRY;
  return CELL_EDGE_GEOMETRY;
}

const boxMaterials = new Map<string, THREE.MeshStandardMaterial>();
const lineMaterials = new Map<string, THREE.LineBasicMaterial>();

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getBoxMaterial(
  color: string,
  opacity: number,
  emissive: string,
  emissiveIntensity: number,
): THREE.MeshStandardMaterial {
  const safeOpacity = Math.max(0.02, Math.min(1, opacity));
  const key = `${color}|${round(safeOpacity)}|${emissive}|${round(emissiveIntensity)}`;
  let material = boxMaterials.get(key);
  if (!material) {
    const opaque = safeOpacity >= 1;
    material = new THREE.MeshStandardMaterial({
      color,
      transparent: !opaque,
      opacity: safeOpacity,
      // 半透明方块不写深度，保证内部的数字标签不会被外层方块吃掉；
      // 完全不透明的岩块则正常写深度，像真正的墙一样遮挡后面的东西
      depthWrite: opaque,
      emissive,
      emissiveIntensity,
      roughness: 0.45,
      metalness: 0.1,
    });
    boxMaterials.set(key, material);
  }
  return material;
}

export function getLineMaterial(color: string, opacity: number): THREE.LineBasicMaterial {
  const safeOpacity = Math.max(0.02, Math.min(1, opacity));
  const key = `${color}|${round(safeOpacity)}`;
  let material = lineMaterials.get(key);
  if (!material) {
    material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: safeOpacity,
      depthWrite: false,
    });
    lineMaterials.set(key, material);
  }
  return material;
}

/**
 * 把若干个格子的线框合并成一个几何体。
 * 未探索格占绝大多数（8×8×8 时最多 512 个），合并后它们只占 1 个 draw call，
 * 而不是每格一个；拾取仍然由每格独立的 Mesh 负责，交互逻辑不受影响。
 */
export function buildMergedEdges(
  offsets: readonly [number, number, number][],
  scale = 1,
): THREE.BufferGeometry {
  const base = CELL_EDGE_GEOMETRY.getAttribute('position') as THREE.BufferAttribute;
  const baseArray = base.array as ArrayLike<number>;
  const vertexCount = base.count;
  const merged = new Float32Array(vertexCount * 3 * offsets.length);

  for (let i = 0; i < offsets.length; i += 1) {
    const [ox, oy, oz] = offsets[i]!;
    const start = i * vertexCount * 3;
    for (let v = 0; v < vertexCount; v += 1) {
      merged[start + v * 3] = baseArray[v * 3]! * scale + ox;
      merged[start + v * 3 + 1] = baseArray[v * 3 + 1]! * scale + oy;
      merged[start + v * 3 + 2] = baseArray[v * 3 + 2]! * scale + oz;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  return geometry;
}

/** 悬停 / 选中时使用的高亮描边几何体 */
const outlineSource = new THREE.BoxGeometry(1, 1, 1);
export const OUTLINE_GEOMETRY = new THREE.EdgesGeometry(outlineSource);
outlineSource.dispose();

/** 关闭射线检测（标签与描边不参与拾取） */
export const NO_RAYCAST = () => null;
