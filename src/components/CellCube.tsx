import { memo } from 'react';
import { a, useSpring } from '@react-spring/three';
import type { ThreeEvent } from '@react-three/fiber';
import { getLabelMaterial } from '../render/labelTextures';
import {
  NO_RAYCAST,
  getBoxMaterial,
  getLineMaterial,
  getShapeEdgeGeometry,
  getShapeGeometry,
} from '../render/resources';
import type { CellShape } from '../render/theme';

export interface CellCubeProps {
  /** 网格坐标，用于回调 */
  x: number;
  y: number;
  z: number;
  /** 世界坐标（立方体已居中） */
  px: number;
  py: number;
  pz: number;
  color: string;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  edgeColor: string;
  edgeOpacity: number;
  /** 空字符串表示不显示标签 */
  label: string;
  /** 标签在格内的垂直偏移（玩家格把数字抬高，避免和玩家标记重叠） */
  labelOffsetY: number;
  /** 几何形状：靠轮廓区分状态 */
  shape: CellShape;
  /** 方块在格内的相对大小 */
  scale: number;
  /** 是否绘制自己的线框（未探索格由合并线框统一绘制，这里为 false） */
  showEdges: boolean;
  /** 是否响应鼠标（切片外的格子不参与交互） */
  interactive: boolean;
  /** 视觉缩放独立于暂停、结算等交互状态 */
  visualScale?: number;
  /** 射线穿过的全部格子（由近及远），用于深度穿透点击 */
  onSelect: (chain: RayChain, nativeEvent?: MouseEvent) => void;
  onFlag: (chain: RayChain) => void;
  onHover: (x: number, y: number, z: number, entering: boolean) => void;
}

/** 一次点击中射线依次穿过的格子坐标，由近及远 */
export type RayChain = { x: number; y: number; z: number }[];

/**
 * 从 R3F 事件里取出射线命中的全部格子。
 * 每个格子的网格坐标存在 mesh.userData 上；材质为 FrontSide，所以一个方块只会产生一次命中。
 */
function chainFromEvent(event: ThreeEvent<MouseEvent>): RayChain {
  const chain: RayChain = [];
  for (const hit of event.intersections) {
    const data = hit.object.userData as { cellX?: number; cellY?: number; cellZ?: number };
    if (typeof data.cellX !== 'number') continue;
    const last = chain[chain.length - 1];
    if (last && last.x === data.cellX && last.y === data.cellY && last.z === data.cellZ) continue;
    chain.push({ x: data.cellX, y: data.cellY!, z: data.cellZ! });
  }
  return chain;
}

/**
 * 单个格子：一个半透明方块 + 一圈描边 + 一个可选的 Sprite 标签。
 * 所有 props 均为原始值，配合 memo 可以避免父组件重渲染时的无谓更新。
 */
function CellCubeImpl({
  x,
  y,
  z,
  px,
  py,
  pz,
  color,
  opacity,
  emissive,
  emissiveIntensity,
  edgeColor,
  edgeOpacity,
  label,
  labelOffsetY,
  shape,
  scale,
  showEdges,
  interactive,
  visualScale = 1,
  onSelect,
  onFlag,
  onHover,
}: CellCubeProps) {
  const boxMaterial = getBoxMaterial(color, opacity, emissive, emissiveIntensity);
  const edgeMaterial = getLineMaterial(edgeColor, edgeOpacity);
  const labelMaterial = label ? getLabelMaterial(label) : null;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(chainFromEvent(event), event.nativeEvent);
  };

  const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    onFlag(chainFromEvent(event));
  };

  // 只有可交互的格子才挂事件处理器；不可交互时直接关闭射线检测
  const interactionProps = interactive
    ? {
        onClick: handleClick,
        onContextMenu: handleContextMenu,
        onPointerOver: (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(x, y, z, true);
        },
        onPointerOut: () => onHover(x, y, z, false),
      }
    : { raycast: NO_RAYCAST };

  const { animatedScale } = useSpring({
    animatedScale: visualScale,
    config: { mass: 1, tension: 250, friction: 35 },
  });

  return (
    <a.group position={[px, py, pz]} scale={animatedScale}>
      <mesh
        geometry={getShapeGeometry(shape)}
        material={boxMaterial}
        scale={scale}
        renderOrder={1}
        userData={{ cellX: x, cellY: y, cellZ: z }}
        {...interactionProps}
      />
      {showEdges ? (
        <lineSegments
          geometry={getShapeEdgeGeometry(shape)}
          material={edgeMaterial}
          scale={scale}
          renderOrder={2}
          raycast={NO_RAYCAST}
        />
      ) : null}
      {labelMaterial ? (
        <sprite
          material={labelMaterial}
          position={[0, labelOffsetY, 0]}
          scale={[0.6, 0.6, 0.6]}
          renderOrder={20}
          raycast={NO_RAYCAST}
        />
      ) : null}
    </a.group>
  );
}

export const CellCube = memo(CellCubeImpl);
