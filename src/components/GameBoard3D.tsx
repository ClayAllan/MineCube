import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { forwardIdFromView } from '../game/cameraRelative';
import { positionToIndex, sixNeighbors } from '../game/neighbors';
import { getCellVisual } from '../game/selectors';
import type {
  AnalysisState,
  DifficultyOptions,
  DirectionId,
  Dims,
  GameMap,
  Position,
  SliceState,
} from '../game/types';
import type { AnalysisResult } from '../game/analysis';
import { CELL_STYLES, OUT_OF_SLICE_FACTOR, SCENE_BACKGROUND } from '../render/theme';
import { getLabelMaterial } from '../render/labelTextures';
import {
  NO_RAYCAST,
  OUTLINE_GEOMETRY,
  buildMergedEdges,
  getLineMaterial,
} from '../render/resources';
import { CellCube, type RayChain } from './CellCube';

/** 网格坐标 -> 世界坐标（把整个地图居中到原点，每个轴独立） */
function toWorld(value: number, length: number): number {
  return value - (length - 1) / 2;
}

function worldPosition(p: Position, dims: Dims): [number, number, number] {
  return [toWorld(p.x, dims.x), toWorld(p.y, dims.y), toWorld(p.z, dims.z)];
}

/** 相机距离按最长边计算，保证扁长地图也能完整入画 */
function viewRadius(dims: Dims): number {
  return Math.max(dims.x, dims.y, dims.z);
}

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** 相机装配：新开一局时复位视角，点击「聚焦玩家」时把镜头对准玩家 */
function CameraRig({
  dims,
  gameId,
  focusToken,
  player,
}: {
  dims: Dims;
  gameId: number;
  focusToken: number;
  player: Position;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as ControlsLike | null;
  const playerRef = useRef(player);
  playerRef.current = player;
  const radius = viewRadius(dims);
  const targetFocus = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!controls) return;
    const d = radius * 1.75;
    camera.position.set(d * 0.35, d * 0.75, d * 1.6);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [camera, controls, radius, gameId]);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => { targetFocus.current = null; };
    controls.addEventListener?.('start', onStart);
    return () => controls.removeEventListener?.('start', onStart);
  }, [controls]);

  useEffect(() => {
    if (!controls || focusToken === 0) return;
    const target = new THREE.Vector3(...worldPosition(playerRef.current, dims));
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.0001) direction.set(1, 0.8, 1);
    direction.normalize();
    targetFocus.current = {
      target,
      position: target.clone().addScaledVector(direction, radius * 1.25),
    };
  }, [camera, controls, focusToken, dims, radius]);

  useFrame((_, delta) => {
    if (!controls || !targetFocus.current) return;
    const { target, position } = targetFocus.current;
    const dt = 1 - Math.exp(-8 * delta);
    controls.target.lerp(target, dt);
    camera.position.lerp(position, dt);
    controls.update();
    if (controls.target.distanceToSquared(target) < 0.01 && camera.position.distanceToSquared(position) < 0.01) {
      targetFocus.current = null;
    }
  });

  return null;
}

/**
 * 上报相机的水平朝向（吸附到最近的世界轴）。
 *
 * 监听 OrbitControls 的 change 事件而不是逐帧轮询：相机不动时完全没有开销，
 * 并且只在吸附结果真正变化时才回调，不会频繁触发 React 重渲染。
 */
function CameraDirectionReporter({ onChange }: { onChange: (forward: DirectionId) => void }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as ControlsLike | null;
  const lastRef = useRef<DirectionId | null>(null);

  useEffect(() => {
    if (!controls) return;
    const report = () => {
      const forward = forwardIdFromView(
        controls.target.x - camera.position.x,
        controls.target.z - camera.position.z,
      );
      if (forward !== lastRef.current) {
        lastRef.current = forward;
        onChange(forward);
      }
    };
    // 挂载时先上报一次当前朝向
    report();
    controls.addEventListener?.('change', report);
    return () => controls.removeEventListener?.('change', report);
  }, [camera, controls, onChange]);

  return null;
}

/**
 * 第一人称相机：把镜头放到玩家所在格的中心，按 yaw / pitch 转动。
 *
 * 这里不用 OrbitControls（那是绕着目标转，不是站在原地看），
 * 也不用 useFrame 逐帧写相机 —— 位置和角度都只在真正变化时更新一次。
 */
function FirstPersonRig({
  position,
  yaw,
  pitch,
  fov,
}: {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  fov: number;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const targetPos = useRef(new THREE.Vector3(...position));
  const targetRot = useRef(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const targetFov = useRef(fov);

  useEffect(() => {
    targetPos.current.set(...position);
    targetRot.current.set(pitch, yaw, 0, 'YXZ');
    targetFov.current = fov;
    camera.rotation.order = 'YXZ'; // Ensure order is set
  }, [camera, position, yaw, pitch, fov]);

  useFrame((_, delta) => {
    const dt = 1 - Math.exp(-12 * delta);
    camera.position.lerp(targetPos.current, dt);
    
    const qTarget = new THREE.Quaternion().setFromEuler(targetRot.current);
    camera.quaternion.slerp(qTarget, dt);
    
    if (Math.abs(camera.fov - targetFov.current) > 0.1) {
      camera.fov += (targetFov.current - camera.fov) * dt;
      camera.updateProjectionMatrix();
    }
  });

  // 离开第一人称时把 fov 还原，避免影响轨道视角
  useEffect(
    () => () => {
      camera.fov = 45;
      camera.updateProjectionMatrix();
    },
    [camera],
  );

  return null;
}

/** 玩家标记：发光八面体 + 缓慢自转与呼吸缩放，辨识度优先 */
function PlayerMarker({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    const group = ref.current;
    if (!group) return;
    const t = state.clock.elapsedTime;
    group.rotation.y = t * 0.9;
    group.rotation.x = Math.sin(t * 0.6) * 0.25;
    const scale = 1 + Math.sin(t * 3) * 0.07;
    group.scale.setScalar(scale);
  });

  return (
    <group ref={ref} position={position} raycast={NO_RAYCAST}>
      <mesh raycast={NO_RAYCAST}>
        <octahedronGeometry args={[0.3, 0]} />
        <meshStandardMaterial
          color="#ecfeff"
          emissive="#22d3ee"
          emissiveIntensity={1.4}
          roughness={0.25}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <torusGeometry args={[0.42, 0.025, 8, 32]} />
        <meshStandardMaterial
          color="#67e8f9"
          emissive="#22d3ee"
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </mesh>
      <pointLight color="#22d3ee" intensity={2.2} distance={4} />
    </group>
  );
}

/** 地图外框，提供空间参考 */
function BoundingCube({ dims }: { dims: Dims }) {
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(dims.x, dims.y, dims.z);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [dims.x, dims.y, dims.z]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments
      geometry={geometry}
      material={getLineMaterial('#38bdf8', 0.35)}
      raycast={NO_RAYCAST}
    />
  );
}

/** 坐标轴指示器：明确 X 左右、Y 上下、Z 前后的对应关系 */
function AxisGizmo({ dims }: { dims: Dims }) {
  const origin: [number, number, number] = [
    -(dims.x / 2) - 0.9,
    -(dims.y / 2) - 0.9,
    -(dims.z / 2) - 0.9,
  ];
  const length = 1.7;

  const axes = useMemo(
    () =>
      [
        { color: '#f87171', label: 'X+右', end: [length, 0, 0] as const },
        { color: '#4ade80', label: 'Y+上', end: [0, length, 0] as const },
        { color: '#60a5fa', label: 'Z+后', end: [0, 0, length] as const },
      ].map((axis) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(...axis.end),
        ]);
        return { ...axis, geometry };
      }),
    [],
  );

  useEffect(() => () => axes.forEach((axis) => axis.geometry.dispose()), [axes]);

  return (
    <group position={origin} raycast={NO_RAYCAST}>
      {axes.map((axis) => {
        const material = getLabelMaterial(axis.label);
        return (
          <group key={axis.label}>
            <lineSegments
              geometry={axis.geometry}
              material={getLineMaterial(axis.color, 0.95)}
              raycast={NO_RAYCAST}
            />
            {material ? (
              <sprite
                material={material}
                position={[axis.end[0] * 1.22, axis.end[1] * 1.22, axis.end[2] * 1.22]}
                scale={[0.85, 0.85, 0.85]}
                raycast={NO_RAYCAST}
              />
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

/** 未探索格的合并线框（一次 draw call 画完所有未探索格的边框） */
function MergedEdges({
  offsets,
  color,
  opacity,
  scale,
}: {
  offsets: [number, number, number][];
  color: string;
  opacity: number;
  scale: number;
}) {
  // 只有未探索格集合发生变化时才重建几何体（每次移动最多一次）
  let hash = offsets.length;
  for (let i = 0; i < offsets.length; i += 1) {
    const [ox, oy, oz] = offsets[i]!;
    hash = (Math.imul(hash, 31) + ox * 73856093 + oy * 19349663 + oz * 83492791) | 0;
  }
  const key = `${offsets.length}:${hash}`;
  // 依赖 key 而不是 offsets 本身：offsets 每次渲染都是新数组，但内容通常没变
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const geometry = useMemo(
    () => (offsetsRef.current.length === 0 ? null : buildMergedEdges(offsetsRef.current, scaleRef.current)),
    [key],
  );

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  return (
    <lineSegments
      geometry={geometry}
      material={getLineMaterial(color, opacity)}
      renderOrder={2}
      raycast={NO_RAYCAST}
    />
  );
}

/** 分析模式的浮标：结论（安全 / 有雷）或概率估计，浮在格子上方 */
function AnalysisBadge({
  position,
  label,
}: {
  position: [number, number, number];
  label: string;
}) {
  const material = getLabelMaterial(label);
  if (!material) return null;
  return (
    <sprite
      material={material}
      position={[position[0], position[1] + 0.34, position[2]]}
      scale={[0.46, 0.46, 0.46]}
      renderOrder={25}
      raycast={NO_RAYCAST}
    />
  );
}

interface SceneProps {
  map: GameMap;
  player: Position;
  slice: SliceState;
  revealAllMines: boolean;
  selected: Position | null;
  interactive: boolean;
  analysis: AnalysisState;
  analysisResult: AnalysisResult;
  difficulty: DifficultyOptions;
  /** 第一人称模式：玩家自身的格子与标记要隐藏，否则镜头会卡在方块里 */
  firstPerson: boolean;
  onSelect: (position: Position | null) => void;
  onFlag: (position: Position) => void;
}

function Scene({
  map,
  player,
  slice,
  revealAllMines,
  selected,
  interactive,
  analysis,
  analysisResult,
  difficulty,
  firstPerson,
  onSelect,
  onFlag,
}: SceneProps) {
  const { dims } = map;
  const analysisActive = analysis.enabled && analysisResult.cells.size > 0;
  // 玩家的六个可能去向：这几格的概率最值得直接标在场景里
  const playerNeighbors = new Set(
    sixNeighbors(dims, player).map((p) => positionToIndex(dims, p)),
  );
  const [hovered, setHovered] = useState<Position | null>(null);

  // 深度穿透点击：记住上一次射线穿过的格子序列与当前深度
  const chainRef = useRef({ key: '', index: 0 });
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const chainKey = (chain: RayChain) => chain.map((p) => `${p.x},${p.y},${p.z}`).join('|');

  // 稳定的回调，保证 CellCube 的 memo 生效
  const handleSelect = useCallback(
    (chain: RayChain) => {
      if (chain.length === 0) return;
      const key = chainKey(chain);
      // 在同一位置重复点击时，沿射线依次向内切换，从而选中被外壳挡住的格子
      chainRef.current =
        chainRef.current.key === key
          ? { key, index: (chainRef.current.index + 1) % chain.length }
          : { key, index: 0 };
      onSelect(chain[chainRef.current.index]!);
    },
    [onSelect],
  );

  const handleFlag = useCallback(
    (chain: RayChain) => {
      if (chain.length === 0) return;
      const current = selectedRef.current;
      // 射线穿过当前选中格时就给它插旗，否则先落到最外层
      const hit = current
        ? chain.find((p) => p.x === current.x && p.y === current.y && p.z === current.z)
        : undefined;
      const target = hit ?? chain[0]!;
      if (!hit) {
        chainRef.current = { key: chainKey(chain), index: 0 };
        onSelect(target);
      }
      onFlag(target);
    },
    [onFlag, onSelect],
  );
  const handleHover = useCallback((x: number, y: number, z: number, entering: boolean) => {
    setHovered((current) => {
      if (entering) return { x, y, z };
      if (current && current.x === x && current.y === y && current.z === z) return null;
      return current;
    });
  }, []);

  // 未探索格的线框合并绘制：8×8×8 时可以省下数百个 draw call
  const plainEdgeOffsets: [number, number, number][] = [];
  const dimEdgeOffsets: [number, number, number][] = [];

  const analysisBadges: { key: string; position: [number, number, number]; label: string }[] = [];
  const analysisOutlines: { key: string; position: Position; color: string }[] = [];

  const cells = map.cells.map((cell, index) => {
    const visual = getCellVisual(cell, {
      player,
      start: map.start,
      end: map.end,
      slice,
      revealAllMines,
      showEnd: difficulty.showEndPosition,
      showEndNumber: difficulty.showEndNumber,
      showOrthogonalCount: difficulty.showOrthogonalCount,
    });

    const analysisState = analysisActive ? analysisResult.cells.get(index) : undefined;
    // 「只显示重叠区域」：除线索格、交集格与玩家 / 起终点外全部隐藏
    const hiddenByOverlap =
      analysisActive &&
      analysis.onlyOverlap &&
      analysisResult.clues.length > 0 &&
      !(analysisState?.isClue || analysisState?.inIntersection) &&
      visual.kind !== 'player' &&
      visual.kind !== 'start' &&
      visual.kind !== 'end';

    // 第一人称时镜头就在玩家格中心，自己的格子必须隐藏
    const hiddenSelf = firstPerson && visual.kind === 'player';
    if (!visual.visible || hiddenByOverlap || hiddenSelf) return null;

    const style = CELL_STYLES[visual.kind];
    const dimmed = !visual.inSlice;
    // 不在当前切片层的格子保留极低透明度，作为空间参考但不遮挡视线
    const opacity = dimmed ? style.opacity * OUT_OF_SLICE_FACTOR : style.opacity;
    const edgeOpacity = dimmed ? style.edgeOpacity * OUT_OF_SLICE_FACTOR : style.edgeOpacity;
    const showLabel = !dimmed && visual.label !== '';
    // 玩家格的数字抬高一点，避免被中间的玩家标记盖住
    const labelOffsetY = visual.kind === 'player' ? 0.36 : 0;

    const [wx, wy, wz] = worldPosition(cell.position, dims);
    const mergeEdges = visual.kind === 'unknown' && !analysisState;
    if (mergeEdges) (dimmed ? dimEdgeOffsets : plainEdgeOffsets).push([wx, wy, wz]);

    if (analysisState && !dimmed) {
      const key = `${cell.position.x}-${cell.position.y}-${cell.position.z}`;
      if (analysisState.isClue) {
        analysisOutlines.push({ key: `clue-${key}`, position: cell.position, color: '#c084fc' });
      } else if (analysisState.verdict === 'mine') {
        analysisOutlines.push({ key: `an-${key}`, position: cell.position, color: '#f87171' });
        analysisBadges.push({ key: `ab-${key}`, position: [wx, wy, wz], label: 'verdict:mine' });
      } else if (analysisState.verdict === 'safe') {
        analysisOutlines.push({ key: `an-${key}`, position: cell.position, color: '#4ade80' });
        analysisBadges.push({ key: `ab-${key}`, position: [wx, wy, wz], label: 'verdict:safe' });
      } else if (analysisState.inIntersection || playerNeighbors.has(index)) {
        analysisOutlines.push({ key: `an-${key}`, position: cell.position, color: '#facc15' });
        analysisBadges.push({
          key: `ab-${key}`,
          position: [wx, wy, wz],
          label: `prob:${Math.round(analysisState.probability * 100)}`,
        });
      }
    }

    return (
      <CellCube
        key={`${cell.position.x}-${cell.position.y}-${cell.position.z}`}
        x={cell.position.x}
        y={cell.position.y}
        z={cell.position.z}
        px={wx}
        py={wy}
        pz={wz}
        color={style.color}
        opacity={opacity}
        emissive={style.emissive}
        emissiveIntensity={dimmed ? 0 : style.emissiveIntensity}
        edgeColor={style.edgeColor}
        edgeOpacity={edgeOpacity}
        label={showLabel ? visual.label : ''}
        labelOffsetY={labelOffsetY}
        shape={style.shape}
        scale={style.scale}
        showEdges={!mergeEdges}
        interactive={interactive && !dimmed}
        onSelect={handleSelect}
        onFlag={handleFlag}
        onHover={handleHover}
      />
    );
  });

  const outline = (position: Position, color: string, scale: number, key?: string) => (
    <lineSegments
      key={key}
      geometry={OUTLINE_GEOMETRY}
      material={getLineMaterial(color, 1)}
      position={worldPosition(position, dims)}
      scale={[scale, scale, scale]}
      renderOrder={30}
      raycast={NO_RAYCAST}
    />
  );

  return (
    <group>
      <BoundingCube dims={dims} />
      <AxisGizmo dims={dims} />
      {cells}
      <MergedEdges
        offsets={plainEdgeOffsets}
        color={CELL_STYLES.unknown.edgeColor}
        opacity={CELL_STYLES.unknown.edgeOpacity}
        scale={CELL_STYLES.unknown.scale}
      />
      <MergedEdges
        offsets={dimEdgeOffsets}
        color={CELL_STYLES.unknown.edgeColor}
        opacity={CELL_STYLES.unknown.edgeOpacity * OUT_OF_SLICE_FACTOR}
        scale={CELL_STYLES.unknown.scale}
      />
      {analysisOutlines.map((item) => outline(item.position, item.color, 0.99, item.key))}
      {analysisBadges.map((badge) => (
        <AnalysisBadge key={badge.key} position={badge.position} label={badge.label} />
      ))}
      {selected ? outline(selected, '#facc15', 0.97) : null}
      {hovered ? outline(hovered, '#f8fafc', 1.02) : null}
      {firstPerson ? null : <PlayerMarker position={worldPosition(player, dims)} />}
    </group>
  );
}

export interface GameBoard3DProps {
  map: GameMap;
  analysis: AnalysisState;
  analysisResult: AnalysisResult;
  difficulty: DifficultyOptions;
  /** 第一人称模式 */
  firstPerson: boolean;
  /** 第一人称的偏航角与俯仰角（弧度） */
  yaw: number;
  pitch: number;
  player: Position;
  slice: SliceState;
  revealAllMines: boolean;
  selected: Position | null;
  interactive: boolean;
  gameId: number;
  focusToken: number;
  onViewForwardChange: (forward: DirectionId) => void;
  onSelect: (position: Position | null) => void;
  onFlag: (position: Position) => void;
}

function GameBoard3DImpl(props: GameBoard3DProps) {
  const { map, player, gameId, focusToken, onViewForwardChange, firstPerson, yaw, pitch } = props;
  const radius = viewRadius(map.dims);
  const initialDistance = radius * 1.75;

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: [initialDistance * 0.35, initialDistance * 0.75, initialDistance * 1.6],
        fov: 45,
        near: 0.1,
        far: 200,
      }}
      // 关闭阴影，保持高帧率
      shadows={false}
      onContextMenu={(event) => event.preventDefault()}
      // 点击空白处取消选中
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[SCENE_BACKGROUND]} />
      {/* 第一人称下雾要贴身，才有"看不远"的闯关感；轨道视角则只在远处淡出 */}
      <fog
        attach="fog"
        args={
          firstPerson
            ? [SCENE_BACKGROUND, 1.5, 9]
            : [SCENE_BACKGROUND, radius * 2.2, radius * 6]
        }
      />
      <ambientLight intensity={1.1} />
      <directionalLight position={[8, 12, 10]} intensity={1.5} />
      <directionalLight position={[-10, -6, -8]} intensity={0.5} color="#93c5fd" />
      <Scene {...props} />
      {firstPerson ? (
        <FirstPersonRig
          position={worldPosition(player, map.dims)}
          yaw={yaw}
          pitch={pitch}
          fov={78}
        />
      ) : (
        <>
          <CameraRig dims={map.dims} gameId={gameId} focusToken={focusToken} player={player} />
          <CameraDirectionReporter onChange={onViewForwardChange} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.12}
            minDistance={radius * 0.6}
            maxDistance={radius * 6}
          />
        </>
      )}
      <EffectComposer multisampling={4}>
        <Bloom luminanceThreshold={0.7} mipmapBlur intensity={0.8} />
      </EffectComposer>
    </Canvas>
  );
}

export const GameBoard3D = memo(GameBoard3DImpl);
