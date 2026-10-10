import type { DirectionId } from './types';

/**
 * 相机相对移动。
 *
 * 默认情况下 W 恒等于「Z 减小」，把视角转到地图背面后就会反直觉。
 * 开启相机相对移动后，W 表示「远离相机」：把相机的水平朝向吸附到最近的世界轴，
 * 再据此把按键映射到实际的世界方向。Q/E（上下）始终保持世界坐标，不受相机影响。
 */

export type DirectionMap = Record<DirectionId, DirectionId>;

/** 只考虑水平面的四个方向 */
const HORIZONTAL: { id: DirectionId; x: number; z: number }[] = [
  { id: 'forward', x: 0, z: -1 },
  { id: 'back', x: 0, z: 1 },
  { id: 'left', x: -1, z: 0 },
  { id: 'right', x: 1, z: 0 },
];

function idOf(x: number, z: number): DirectionId {
  const found = HORIZONTAL.find((entry) => entry.x === x && entry.z === z);
  return found ? found.id : 'forward';
}

/**
 * 由第一人称的偏航角求出水平朝向向量。
 *
 * 相机用 `rotation.set(pitch, yaw, 0, 'YXZ')`，默认（yaw = 0）看向 -Z；
 * 绕 Y 轴旋转 yaw 后，-Z 轴映射到 (-sin yaw, 0, -cos yaw)。
 */
export function viewVectorFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** 由偏航角直接得到吸附后的朝向 id */
export function forwardIdFromYaw(yaw: number): DirectionId {
  const v = viewVectorFromYaw(yaw);
  return forwardIdFromView(v.x, v.z);
}

/** 由方向 id 反推偏航角，用于从轨道视角切进第一人称时对齐镜头 */
export function yawFromForwardId(forward: DirectionId): number {
  switch (forward) {
    case 'back':
      return Math.PI;
    case 'left':
      return Math.PI / 2;
    case 'right':
      return (Math.PI * 3) / 2;
    default:
      return 0;
  }
}

/** 把偏航角规范到 [0, 2π) */
export function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  return ((yaw % twoPi) + twoPi) % twoPi;
}

/** 吸附到最近的 90°，用于方向键的整格转向 */
export function snapYaw(yaw: number): number {
  const quarter = Math.PI / 2;
  return normalizeYaw(Math.round(yaw / quarter) * quarter);
}

/**
 * 把相机看向的水平方向（target − cameraPosition 在 XZ 平面上的投影）
 * 吸附到最近的世界轴，返回对应的方向 id。
 */
export function forwardIdFromView(viewX: number, viewZ: number): DirectionId {
  if (!Number.isFinite(viewX) || !Number.isFinite(viewZ)) return 'forward';
  if (viewX === 0 && viewZ === 0) return 'forward';
  if (Math.abs(viewX) >= Math.abs(viewZ)) {
    return idOf(Math.sign(viewX), 0);
  }
  return idOf(0, Math.sign(viewZ));
}

/** 恒等映射：按键就是世界方向（相机相对移动关闭时使用） */
export const IDENTITY_DIRECTION_MAP: DirectionMap = {
  forward: 'forward',
  back: 'back',
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
};

/**
 * 由「W 实际指向的世界方向」推出全部六个按键的映射。
 * 右手方向按右手系计算：right = forward × up。
 */
export function directionMapFromForward(forward: DirectionId): DirectionMap {
  const entry = HORIZONTAL.find((item) => item.id === forward);
  if (!entry) return IDENTITY_DIRECTION_MAP;
  const { x: fx, z: fz } = entry;
  const rx = -fz;
  const rz = fx;
  return {
    forward: idOf(fx, fz),
    back: idOf(-fx, -fz),
    right: idOf(rx, rz),
    left: idOf(-rx, -rz),
    up: 'up',
    down: 'down',
  };
}
