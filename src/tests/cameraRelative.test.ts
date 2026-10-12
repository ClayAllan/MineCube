import { describe, expect, it } from 'vitest';
import {
  IDENTITY_DIRECTION_MAP,
  directionMapFromForward,
  forwardIdFromView,
  forwardIdFromYaw,
  normalizeYaw,
  snapYaw,
  viewVectorFromYaw,
  yawFromForwardId,
} from '../game/cameraRelative';
import { DIRECTIONS } from '../game/constants';
import type { DirectionId } from '../game/types';

const deltaOf = (id: DirectionId) => DIRECTIONS.find((d) => d.id === id)!.delta;

describe('相机朝向吸附', () => {
  it('默认机位（相机在 +X/+Y/+Z 一侧）对应 W = Z−，与世界模式一致', () => {
    // view = target − camera = (−d, …, −1.12d)，|z| 更大 -> 吸附到 Z−
    expect(forwardIdFromView(-7, -7.84)).toBe('forward');
  });

  it('按占优的水平分量吸附到最近的世界轴', () => {
    expect(forwardIdFromView(0, -1)).toBe('forward');
    expect(forwardIdFromView(0, 1)).toBe('back');
    expect(forwardIdFromView(-1, 0)).toBe('left');
    expect(forwardIdFromView(1, 0)).toBe('right');
    expect(forwardIdFromView(3, -1)).toBe('right');
    expect(forwardIdFromView(-0.2, 5)).toBe('back');
  });

  it('退化输入有稳定兜底', () => {
    expect(forwardIdFromView(0, 0)).toBe('forward');
    expect(forwardIdFromView(Number.NaN, 1)).toBe('forward');
  });
});

describe('第一人称偏航角', () => {
  it('yaw = 0 时看向 Z−，与默认「前」一致', () => {
    const v = viewVectorFromYaw(0);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
    expect(forwardIdFromYaw(0)).toBe('forward');
  });

  it('四个正方向的偏航角与方向 id 互相自洽', () => {
    for (const id of ['forward', 'back', 'left', 'right'] as const) {
      expect(forwardIdFromYaw(yawFromForwardId(id))).toBe(id);
    }
  });

  it('绕 Y 轴转 90° 依次经过 前 → 左 → 后 → 右', () => {
    const quarter = Math.PI / 2;
    expect(forwardIdFromYaw(0)).toBe('forward');
    expect(forwardIdFromYaw(quarter)).toBe('left');
    expect(forwardIdFromYaw(quarter * 2)).toBe('back');
    expect(forwardIdFromYaw(quarter * 3)).toBe('right');
  });

  it('偏航角会被规范到 [0, 2π)', () => {
    expect(normalizeYaw(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2, 6);
    expect(normalizeYaw(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeYaw(0)).toBe(0);
  });

  it('snapYaw 吸附到最近的 90°', () => {
    const quarter = Math.PI / 2;
    expect(snapYaw(0.1)).toBeCloseTo(0, 6);
    expect(snapYaw(quarter - 0.1)).toBeCloseTo(quarter, 6);
    expect(snapYaw(quarter + 0.1)).toBeCloseTo(quarter, 6);
    // 吸附结果始终落在 [0, 2π)
    expect(snapYaw(-quarter)).toBeCloseTo(quarter * 3, 6);
  });

  it('任意角度吸附后仍然对应一个合法方向', () => {
    for (let a = -10; a < 10; a += 0.37) {
      const snapped = snapYaw(a);
      expect(['forward', 'back', 'left', 'right']).toContain(forwardIdFromYaw(snapped));
    }
  });
});

describe('按键到世界方向的映射', () => {
  it('W 指向 Z− 时映射就是恒等映射', () => {
    expect(directionMapFromForward('forward')).toEqual(IDENTITY_DIRECTION_MAP);
  });

  it('相机转到背面后，W 变成 Z+、A/D 也整体翻转', () => {
    const map = directionMapFromForward('back');
    expect(map.forward).toBe('back');
    expect(map.back).toBe('forward');
    expect(map.left).toBe('right');
    expect(map.right).toBe('left');
  });

  it('相机在 X 轴一侧时，W/S 走 X、A/D 走 Z', () => {
    const map = directionMapFromForward('right');
    expect(map.forward).toBe('right');
    expect(map.back).toBe('left');
    // 右手系：朝向 +X 时右手指向 +Z
    expect(map.right).toBe('back');
    expect(map.left).toBe('forward');
  });

  it('上下始终保持世界坐标，不受相机影响', () => {
    for (const forward of ['forward', 'back', 'left', 'right'] as const) {
      const map = directionMapFromForward(forward);
      expect(map.up).toBe('up');
      expect(map.down).toBe('down');
    }
  });

  it('任何朝向下，映射都是六个方向的一一对应', () => {
    for (const forward of ['forward', 'back', 'left', 'right'] as const) {
      const map = directionMapFromForward(forward);
      expect(new Set(Object.values(map)).size).toBe(6);
    }
  });

  it('前后互为反向、左右互为反向，且左右与前后垂直', () => {
    for (const forward of ['forward', 'back', 'left', 'right'] as const) {
      const map = directionMapFromForward(forward);
      const f = deltaOf(map.forward);
      const b = deltaOf(map.back);
      const r = deltaOf(map.right);
      const l = deltaOf(map.left);
      expect({ x: f.x + b.x, y: f.y + b.y, z: f.z + b.z }).toEqual({ x: 0, y: 0, z: 0 });
      expect({ x: r.x + l.x, y: r.y + l.y, z: r.z + l.z }).toEqual({ x: 0, y: 0, z: 0 });
      // 点积为 0 -> 互相垂直
      expect(f.x * r.x + f.y * r.y + f.z * r.z).toBe(0);
    }
  });
});
