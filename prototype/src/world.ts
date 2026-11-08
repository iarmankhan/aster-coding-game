import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { worldMissionView, type WorldMissionContext } from './world-regions';
import { missionCatalog, missionIds } from './mission-catalog';
import { buildProgramPlayback, type ProgramFrame } from './program-playback';
import type { ProgramPlayback } from './program-mission-types';
export type { WorldMissionContext } from './world-regions';

export type WorldNode = { id: string; label: string; position: [number, number]; detail?: string };
export type PresentationMode = 'title' | 'tour' | 'work';
export type DeliveryParcel = { receiptId: string; item: string; units: number };
export type DeliveryPlaybackOptions = { onComplete?: () => void };
export type ProgramPlaybackOptions = { onComplete?: () => void; signal?: AbortSignal };

export interface WorldOptions {
  nodes: WorldNode[];
  edges: [string, string][];
  blockedEdge: [string, string];
  onSelect?: (id: string) => void;
}

export interface RouteOptions {
  success?: boolean;
  onComplete?: () => void;
}

export interface World {
  readonly programReader: HTMLElement;
  playProgram(sample: ProgramPlayback, options: ProgramPlaybackOptions): void;
  setMissionContext(context: WorldMissionContext): void;
  playRoute(route: readonly (string | Pick<WorldNode, 'id'>)[], options?: RouteOptions): void;
  playDeliveries(deliveries: readonly DeliveryParcel[], accepted: readonly DeliveryParcel[], options?: DeliveryPlaybackOptions): void;
  setSuppliesRestored(value: boolean): void;
  reset(): void;
  setRestored(value: boolean): void;
  setTheme(theme: 'dusk' | 'day'): void;
  setPaused(value: boolean): void;
  focusNode(id: string): void;
  setPresentation(mode: PresentationMode): void;
  showOverview(): void;
  setMapVisible(value: boolean): void;
  dispose(): void;
}

type Position = readonly [number, number, number];
type SceneNode = WorldNode & { point: THREE.Vector3; labelPoint: THREE.Vector3 };
interface RouteState {
  ids: string[];
  points: THREE.Vector3[];
  segment: number;
  progress: number;
  success: boolean;
  onComplete?: () => void;
}
type IntakeRow = DeliveryParcel & { decision: 'accepted' | 'duplicate' };
type IntakeState = { rows: IntakeRow[]; index: number; progress: number; onComplete?: () => void };

const PALETTE = {
  water: '#527f82', metal: '#637b76', dark: '#344c4e', deck: '#aa8c67',
  cream: '#d9dfd0', orange: '#d9a36c', rust: '#9d6e54', sage: '#91a37b',
  glass: '#8bb3a8', ink: '#243d43', light: '#f6cb82',
};

const HEX_RADIUS = 1.45;
const STATION_TILES: Record<string, readonly [number, number]> = {
  dock: [-4, 1], relay: [-2, -1], junction: [0, 1],
  observatory: [-1, 3], garden: [2, 0], greenhouse: [2, -2],
};
const LANDMARK_OFFSETS: Record<string, readonly [number, number]> = {
  relay: [0, -0.42], junction: [-1.62, 1.52],
  observatory: [-1.2, 0.6], garden: [1.35, -0.45], greenhouse: [0, -0.75],
};
const tilePoint = (q: number, r: number): THREE.Vector3 => new THREE.Vector3(
  Math.sqrt(3) * HEX_RADIUS * (q + r / 2), 0.3, HEX_RADIUS * 1.5 * r,
);

export function createWorld(container: HTMLElement, { nodes, edges, blockedEdge, onSelect }: WorldOptions): World {
  let disposed = false;
  let missionContext = worldMissionView({ activeMission: 'first-light', completed: [] });
  const originalAriaLabel = container.getAttribute('aria-label');
  const baseAriaLabel = originalAriaLabel || 'Interactive coastal settlement. Drag to orbit. Select a station to inspect it.';
  const legend = document.createElement('div');
  legend.className = 'world-context-legend';
  legend.setAttribute('aria-hidden', 'true');
  legend.style.cssText = 'position:absolute;left:10px;right:10px;bottom:36px;z-index:3;display:flex;flex-wrap:wrap;gap:4px 12px;pointer-events:none;color:#f6eedb;font:500 12px/1.4 Manrope,sans-serif;';
  const legendItems = ['● Active problem', '0 / 11 complete', ''].map((text) => {
    const item = document.createElement('span');
    item.textContent = text;
    item.style.cssText = 'padding:3px 6px;border-radius:3px;background:rgba(32,54,52,.9);';
    legend.append(item);
    return item;
  });
  legendItems[0].style.borderLeft = '2px solid #f5c77d';
  container.append(legend);
  const programReader = document.createElement('section');
  programReader.className = 'program-reader';
  programReader.setAttribute('aria-label', 'Public result playback');
  programReader.style.cssText = 'font:400 14px/1.6 Manrope,sans-serif;color:inherit;padding:12px 0;min-width:0;overflow-wrap:anywhere;';
  const contextReader = document.createElement('details');
  const contextSummary = document.createElement('summary');
  contextSummary.textContent = 'Station mission context';
  const contextText = document.createElement('div');
  contextReader.append(contextSummary, contextText);
  const resultReader = document.createElement('details');
  resultReader.open = true;
  const resultSummary = document.createElement('summary');
  resultSummary.textContent = 'Current public result';
  const programStatus = document.createElement('p');
  programStatus.setAttribute('role', 'status');
  programStatus.setAttribute('aria-live', 'polite');
  const programControls = document.createElement('div');
  programControls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;';
  const buttons = ['Pause', 'Previous', 'Next', 'Replay'].map((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = true;
    button.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;padding:5px 10px;cursor:pointer;';
    programControls.append(button);
    return button;
  });
  const frameReader = document.createElement('div');
  const outputReader = document.createElement('pre');
  outputReader.style.cssText = 'font:400 14px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;max-height:none;';
  resultReader.append(resultSummary, programStatus, programControls, frameReader, outputReader);
  programReader.append(contextReader, resultReader);
  const noTrace = () => {
    delete programReader.dataset.caseId;
    programStatus.textContent = 'No result trace saved. Submit current code to view a new result. Earned service status does not save quantitative output.';
    frameReader.replaceChildren();
    outputReader.textContent = '';
    buttons.forEach((button) => { button.disabled = true; button.style.opacity = '0.5'; button.style.cursor = 'default'; });
  };
  const clearProgramAttributes = () => {
    for (const key of ['programMission', 'programResult', 'programTrace', 'programProgress', 'programState']) delete container.dataset[key];
  };
  noTrace();
  function writeMissionContext(): void {
    container.dataset.activeMission = missionContext.activeMission;
    container.dataset.missionTarget = missionContext.target;
    container.dataset.missionRegions = missionContext.serialized;
    container.setAttribute('aria-label', `${baseAriaLabel} ${missionContext.description}`);
    legendItems[1].textContent = `${missionContext.completedCount} / ${missionIds.length} complete`;
    legendItems[2].textContent = missionContext.lockLabel;
    contextText.replaceChildren(...missionContext.clusters.map((cluster) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = `${cluster.nodeId}. ${cluster.description}`;
      return paragraph;
    }));
  }
  function clearMissionContext(): void {
    legend.remove();
    delete container.dataset.activeMission;
    delete container.dataset.missionTarget;
    delete container.dataset.missionRegions;
    if (originalAriaLabel === null) container.removeAttribute('aria-label');
    else container.setAttribute('aria-label', originalAriaLabel);
  }
  writeMissionContext();
  container.dataset.routeTrace = JSON.stringify(['dock']);
  container.dataset.restored = 'false';
  container.dataset.cameraMoving = 'false';
  container.dataset.intakeTrace = '[]';
  container.dataset.deliveredUnits = '0';
  container.dataset.suppliesRestored = 'false';
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    container.dataset.renderer = 'unavailable';
    const message = document.createElement('div');
    message.className = 'world-fallback';
    message.textContent = 'Island view unavailable. Enable WebGL to explore the settlement. The route editor still works.';
    Object.assign(message.style, { padding: '32px', color: PALETTE.cream, font: '14px/1.6 Manrope,sans-serif' });
    container.append(message);
    return {
      programReader,
      playProgram() { if (disposed) return; clearProgramAttributes(); noTrace(); programStatus.textContent = 'Result playback unavailable. WebGL is required. Passed checks alone do not complete a mission.'; },
      setMissionContext(context) {
        if (disposed) return;
        const next = worldMissionView(context);
        if (next === missionContext) return;
        missionContext = next;
        writeMissionContext();
      },
      playRoute() {},
      playDeliveries() {},
      reset() { if (disposed) return; clearProgramAttributes(); noTrace(); container.dataset.routeTrace = '["dock"]'; container.dataset.restored = 'false'; container.dataset.intakeTrace = '[]'; container.dataset.deliveredUnits = '0'; container.dataset.suppliesRestored = 'false'; },
      setRestored(value) { if (!disposed) container.dataset.restored = String(Boolean(value)); },
      setSuppliesRestored(value) { if (!disposed) container.dataset.suppliesRestored = String(Boolean(value)); },
      setTheme() {}, setPaused() {}, focusNode() {},
      setPresentation() {}, showOverview() {}, setMapVisible() {},
      dispose() { if (disposed) return; disposed = true; clearProgramAttributes(); programReader.remove(); message.remove(); clearMissionContext(); },
    };
  }

  container.dataset.renderer = 'webgl';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  renderer.setClearColor(PALETTE.water, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  let shadowsDirty = true;
  renderer.domElement.setAttribute('aria-label', 'Interactive island settlement. Drag to orbit. Select a station to inspect it. Named stations are also available in the mission brief.');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;background:#719b98;';
  container.append(renderer.domElement);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const camera = new THREE.OrthographicCamera(-14, 14, 11, -11, 0.1, 180);
  const mapBounds = new THREE.Box3();
  for (const node of nodes) {
    const tile = STATION_TILES[node.id];
    mapBounds.expandByPoint(tile ? tilePoint(...tile) : new THREE.Vector3(node.position[0], 0.3, node.position[1]));
  }
  const center = mapBounds.isEmpty() ? new THREE.Vector3() : mapBounds.getCenter(new THREE.Vector3());
  center.y = 0.6;
  camera.position.copy(center).add(new THREE.Vector3(9, 25, 27));
  camera.lookAt(center);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = !reducedMotion;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI / 5;
  controls.maxPolarAngle = Math.PI / 3.05;
  controls.minAzimuthAngle = -Math.PI / 3;
  controls.maxAzimuthAngle = Math.PI / 3.1;
  controls.minZoom = 0.8;
  controls.maxZoom = 1.8;
  controls.rotateSpeed = 0.35;
  controls.zoomSpeed = 0.6;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <G extends THREE.BufferGeometry>(geometry: G): G => (geometries.add(geometry), geometry);
  const ownMaterial = <M extends THREE.Material>(material: M): M => (materials.add(material), material);
  const material = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...options }));
  const m = {
    metal: material(PALETTE.metal),
    dark: material(PALETTE.dark), deck: material(PALETTE.deck),
    cream: material(PALETTE.cream),
    orange: material(PALETTE.orange), rust: material(PALETTE.rust),
    sage: material(PALETTE.sage), black: material(PALETTE.ink),
    window: material('#678e83', { roughness: 0.4 }),
    warm: material(PALETTE.light, { emissive: PALETTE.light, emissiveIntensity: 0.6 }),
    leaf: material('#78965a'),
    soil: material('#80674e'),
    glass: material('#7faaa1', { transparent: true, opacity: 0.32, roughness: 0.23, depthWrite: false, side: THREE.DoubleSide }),
    greenhouseWindow: material('#8a9a7c', { emissive: '#f2b877', emissiveIntensity: 0 }),
    shore: material('#bdb69b'),
    earth: material('#56675d'),
    basalt: material('#475a5a'),
    stratum: material('#708078'),
    rock: material('#69786e'),
    grass: material('#8c9b70', { side: THREE.DoubleSide }),
    flower: material('#d8c997'),
    cyan: material('#80b6b6', { emissive: '#72bfc0', emissiveIntensity: 0.35, metalness: 0.25, roughness: 0.5 }),
    solar: material('#3e5e69', { metalness: 0.35, roughness: 0.5 }),
    supplyWindow: material('#66827c', { emissive: PALETTE.light, emissiveIntensity: 0 }),
    cargo: material('#c3ac7b'),
    ghost: material('#b77d68', { transparent: true, opacity: 0.38, depthWrite: false }),
  };
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = ownGeometry(new THREE.SphereGeometry(1, 12, 8));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  const rockGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 0));
  const crownGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 7));
  const ringGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.018, 5, 48));
  const instances: THREE.InstancedMesh[] = [];
  for (const mat of [m.cream, m.metal, m.deck, m.basalt]) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 weatherPoint;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 weatherPosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          weatherPosition=instanceMatrix*weatherPosition;
        #endif
        weatherPoint=(modelMatrix*weatherPosition).xyz;`);
      shader.fragmentShader = `varying vec3 weatherPoint;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        float wear=fract(sin(dot(floor(weatherPoint*18.),vec3(127.1,97.3,311.7)))*43758.5453);
        diffuseColor.rgb*=.965+wear*.065;`);
    };
  }

  function mesh<M extends THREE.Material>(geometry: THREE.BufferGeometry, mat: M, parent: THREE.Object3D, position: Position = [0, 0, 0], scale: Position = [1, 1, 1]): THREE.Mesh<THREE.BufferGeometry, M> {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...position);
    object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const box = (parent: THREE.Object3D, mat: THREE.Material, position: Position, scale: Position) => mesh(boxGeometry, mat, parent, position, scale);
  const cylinder = (parent: THREE.Object3D, mat: THREE.Material, position: Position, radius: number, height: number) => mesh(cylinderGeometry, mat, parent, position, [radius, height, radius]);
  function beam(parent: THREE.Object3D, from: Position, to: Position, radius: number, mat: THREE.Material) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const object = cylinder(parent, mat, a.clone().add(b).multiplyScalar(0.5).toArray(), radius, a.distanceTo(b));
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    return object;
  }
  function ring(parent: THREE.Object3D, position: Position, radius: number, mat: THREE.Material = m.warm) {
    const object = mesh(ringGeometry, mat, parent, position, [radius, radius, radius]);
    object.rotation.x = -Math.PI / 2;
    return object;
  }
  const ambient = new THREE.HemisphereLight('#e6eee1', '#829072', 2.5);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#ffe7c3', 3.2);
  sun.position.set(-8, 18, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 1, far: 60 });
  sun.shadow.normalBias = 0.045;
  sun.shadow.bias = -0.00015;
  scene.add(sun);
  const rimLight = new THREE.DirectionalLight('#d3e4df', 0.8);
  rimLight.position.set(5, 4, -12);
  scene.add(rimLight);

  const settlement = new THREE.Group();
  scene.add(settlement);
  const nodeMap = new Map<string, SceneNode>((nodes || []).map((node) => {
    const tile = STATION_TILES[node.id];
    const point = tile ? tilePoint(...tile) : new THREE.Vector3(node.position[0], 0.3, node.position[1]);
    return [node.id, { ...node, point, labelPoint: point.clone().add(new THREE.Vector3(0, 0, 0.9)) }];
  }));
  const edgeKey = (a: string, b: string): string => [a, b].sort().join('|');
  const blockedKey = blockedEdge?.length === 2 ? edgeKey(...blockedEdge) : '';
  const safeEdges = new Set((edges || []).map(([a, b]) => edgeKey(a, b)).filter((key) => key !== blockedKey));
  const pickables: THREE.Object3D[] = [];
  const selectionRings = new Map<string, THREE.Object3D>();
  const stationBounds = new Map<string, THREE.Box3>();
  const selectionMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#f3d69d', transparent: true, opacity: 0.8, depthWrite: false }));
  const subjectLight = new THREE.PointLight('#ffd5a8', 0, 7, 2);
  scene.add(subjectLight);
  const plantGroups: THREE.Group[] = [];
  let greenhouseLight: THREE.PointLight | undefined;
  let greenhouseGlow: THREE.Object3D | undefined;
  let greenhouseShutters: THREE.Group | undefined;
  let restored = false;
  let restoreAmount = 0;
  const fieldLamps: THREE.PointLight[] = [];
  let supplyPallet: THREE.Group | undefined;
  let supplyLamp: THREE.Object3D | undefined;

  const island = new THREE.Group();
  island.name = 'island';
  settlement.add(island);
  const hexGeometry = ownGeometry(new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, 1, 6));
  const grasses = ['#829478', '#879a77', '#93a17c', '#7c9279'].map((color) => material(color));
  const terrainBounds: THREE.Box3[] = [];
  const rows: readonly [number, number, number][] = [
    [-3, -1, 3], [-2, -2, 3], [-1, -3, 3], [0, -4, 3],
    [1, -4, 2], [2, -3, 1], [3, -3, 0],
  ];
  const tiles: { q: number; r: number; point: THREE.Vector3; top: number; coast: boolean }[] = [];
  const corridorSegments = [...edges, blockedEdge].map(([a, b]) => [nodeMap.get(a)?.point, nodeMap.get(b)?.point]).filter((pair): pair is [THREE.Vector3, THREE.Vector3] => Boolean(pair[0] && pair[1]));
  const distanceToCorridor = (point: THREE.Vector3) => Math.min(...corridorSegments.map(([a, b]) => new THREE.Line3(a, b).closestPointToPoint(point, true, new THREE.Vector3()).setY(point.y).distanceTo(point)));
  const noise = (x: number, z: number) => { const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return value - Math.floor(value); };
  const tileKeys = new Set<string>();
  for (const [r, low, high] of rows) {
    for (let q = low; q <= high; q++) {
      if ((r === -3 && q === 1) || (r === -2 && q === 0) || (r === -1 && q === 0)) continue;
      const point = tilePoint(q, r);
      const courtyard = [...nodeMap.values()].some(({ point: station }) => station.distanceTo(point) < 2.7);
      const protectedTile = courtyard || distanceToCorridor(point) < HEX_RADIUS + 0.55;
      const top = protectedTile ? 0.3 : 0.52 + Math.floor(noise(q, r) * 3) * 0.37;
      tiles.push({ q, r, point, top, coast: false });
      tileKeys.add(`${q},${r}`);
    }
  }
  const neighbors = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const foam = new THREE.Group();
  island.add(foam);
  const foamMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#c7d6bf', transparent: true, opacity: 0.48, depthWrite: false }));
  for (const tileData of tiles) {
      const { q, r, point, top } = tileData;
      tileData.coast = neighbors.some(([dq, dr]) => !tileKeys.has(`${q + dq},${r + dr}`));
      const tile = new THREE.Mesh(hexGeometry, [m.basalt, grasses[(q * q + r * r) % grasses.length], m.basalt]);
      tile.position.set(point.x, (top - 0.68) / 2, point.z);
      tile.scale.y = top + 0.68;
      tile.receiveShadow = true;
      tile.castShadow = true;
      island.add(tile);
      terrainBounds.push(new THREE.Box3().setFromObject(tile));
      mesh(hexGeometry, m.stratum, island, [point.x, -0.17, point.z], [1.004, 0.1, 1.004]);
      mesh(hexGeometry, m.earth, island, [point.x, top - 0.12, point.z], [1.003, 0.11, 1.003]);
      if (top > 0.8) mesh(hexGeometry, m.stratum, island, [point.x, 0.32, point.z], [1.004, 0.055, 1.004]);
      if (!tileData.coast) continue;
      mesh(hexGeometry, m.shore, island, [point.x, -0.55, point.z], [1.095, 0.26, 1.095]);
      for (let side = 0; side < 6; side++) {
        const angle = side * Math.PI / 3;
        const a = new THREE.Vector3(point.x + Math.sin(angle) * HEX_RADIUS * 1.14, -0.475, point.z + Math.cos(angle) * HEX_RADIUS * 1.14);
        const b = new THREE.Vector3(point.x + Math.sin(angle + Math.PI / 3) * HEX_RADIUS * 1.14, -0.475, point.z + Math.cos(angle + Math.PI / 3) * HEX_RADIUS * 1.14);
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        if (tiles.some((other) => other !== tileData && Math.hypot(other.point.x - midpoint.x, other.point.z - midpoint.z) < 1.38)) continue;
        if (noise(q + side * 7, r + 9) > 0.25 && distanceToCorridor(midpoint) > 0.65) {
          const low = 0.06 + noise(q + side, r + 2) * 0.22;
          const high = 0.68 + noise(q - side, r + 7) * 0.24;
          beam(foam, a.clone().lerp(b, low).toArray(), a.clone().lerp(b, high).toArray(), 0.012 + noise(q, r + side) * 0.015, foamMaterial).castShadow = false;
        }
        const rock = mesh(rockGeometry, noise(q + side, r) > 0.5 ? m.rock : m.basalt, island, [midpoint.x, -0.38, midpoint.z], [0.16 + noise(q, side) * 0.25, 0.22, 0.18]);
        rock.rotation.set(0.1, side, 0.25);
      }
  }
  container.dataset.terrainTiles = String(tiles.length);
  const waterGeometry = ownGeometry(new THREE.PlaneGeometry(160, 160, 110, 110));
  const waterColors: number[] = [];
  const waterPositions = waterGeometry.getAttribute('position');
  const deepColor = new THREE.Color(PALETTE.water);
  const shallowColor = new THREE.Color('#87aaa0');
  for (let i = 0; i < waterPositions.count; i++) {
    const x = waterPositions.getX(i), z = -waterPositions.getY(i);
    const distance = Math.min(...tiles.map(({ point }) => Math.hypot(point.x - x, point.z - z))) - HEX_RADIUS;
    const amount = Math.max(0, 1 - Math.max(0, distance) / 3.2) * 0.8;
    const color = deepColor.clone().lerp(shallowColor, amount);
    waterColors.push(color.r, color.g, color.b);
  }
  waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
  const waterMaterial = ownMaterial(new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, dusk: { value: 0 }, motion: { value: reducedMotion ? 0 : 1 } },
    vertexColors: true,
    vertexShader: 'varying vec3 tint; varying vec2 field; void main(){tint=color;field=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform float time; uniform float dusk; uniform float motion; varying vec3 tint; varying vec2 field;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float coastNoise(vec2 p){
        vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(cell),hash(cell+vec2(1.,0.)),f.x),mix(hash(cell+vec2(0.,1.)),hash(cell+vec2(1.,1.)),f.x),f.y);
      }
      void main(){
        float drift=time*motion;
        float warp=coastNoise(field*.075+vec2(4.1,8.7))-.5;
        vec2 p=field+vec2(warp*1.7,warp*.9)+vec2(drift*.026,-drift*.018);
        float broad=coastNoise(p*.17);
        float detail=coastNoise(vec2(p.x*.63+p.y*.12,p.y*.41)+vec2(13.2,5.7));
        float glint=broad*detail*detail*.0025;
        vec3 col=(tint*(.97+broad*.05+detail*.012)+vec3(.009,.016,.014)*(broad-.5))*(1.-dusk*.28)+glint;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const water = mesh(waterGeometry, waterMaterial, scene, [0, -0.5, 0]);
  water.rotation.x = -Math.PI / 2;
  water.castShadow = false;

  const future = new THREE.Group();
  future.name = 'planned-headland';
  future.userData.regionKind = 'planned';
  scene.add(future);
  const headlandMaterial = material('#577b72', { flatShading: true });
  const headland = new THREE.InstancedMesh(crownGeometry, headlandMaterial, 5);
  headland.name = 'future-coast';
  const headlandForms: readonly [Position, Position][] = [
    [[0, -0.5, -18], [3.2, 1.25, 2.1]], [[-2.4, -0.55, -17.6], [2.1, 0.9, 1.4]],
    [[2.7, -0.62, -18.3], [2, 0.85, 1.6]], [[-0.7, 0.15, -18.6], [1.9, 1.1, 1.5]],
    [[1.6, 0.05, -19], [1.6, 1.1, 1.2]],
  ];
  future.scale.set(0.45, 1, 0.45);
  future.position.z = -5.4;
  const backgroundTransform = new THREE.Object3D();
  headlandForms.forEach(([position, scale], index) => {
    backgroundTransform.position.set(...position);
    backgroundTransform.scale.set(...scale);
    backgroundTransform.rotation.set(0.07 * index, index * 1.7, 0.06 * index);
    backgroundTransform.updateMatrix();
    headland.setMatrixAt(index, backgroundTransform.matrix);
  });
  future.add(headland);
  instances.push(headland);
  const mistMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#c0d0c1', transparent: true, opacity: 0.13, depthWrite: false }));
  const mist = new THREE.InstancedMesh(crownGeometry, mistMaterial, 7);
  mist.name = 'planned-mist';
  for (let i = 0; i < 7; i++) {
    backgroundTransform.position.set(-3.5 + i * 1.15, 0.55 + noise(i, 3) * 0.55, -17.6 - noise(i, 8) * 1.5);
    backgroundTransform.scale.set(1.3 + noise(i, 4), 0.35 + noise(i, 2) * 0.2, 1.15);
    backgroundTransform.rotation.set(0, i * 2.4, 0);
    backgroundTransform.updateMatrix();
    mist.setMatrixAt(i, backgroundTransform.matrix);
  }
  future.add(mist);
  instances.push(mist);

  function groundAt(q: number, r: number): number { return tiles.find((tile) => tile.q === q && tile.r === r)?.top ?? 0.3; }

  function tree(q: number, r: number, offsetX = 0, offsetZ = 0, size = 1): void {
    const tree = new THREE.Group();
    tree.name = 'coastal-tree';
    tree.position.copy(tilePoint(q, r)).setY(groundAt(q, r)).add(new THREE.Vector3(offsetX, 0, offsetZ));
    for (const [a, b] of corridorSegments) {
      const closest = new THREE.Line3(a, b).closestPointToPoint(tree.position, true, new THREE.Vector3()).setY(tree.position.y);
      const away = tree.position.clone().sub(closest);
      if (away.length() < 1.3) tree.position.copy(closest).add(away.lengthSq() ? away.setLength(1.3) : new THREE.Vector3(-1.3, 0, 0));
    }
    tree.scale.setScalar(size);
    island.add(tree);
    cylinder(tree, m.deck, [0, 0.42, 0], 0.055, 0.86);
    if ((q + r) % 2 === 0) {
      for (let i = 0; i < 3; i++) mesh(coneGeometry, i === 1 ? m.sage : m.leaf, tree, [0, 0.68 + i * 0.28, 0], [0.48 - i * 0.09, 0.66, 0.48 - i * 0.09]);
    } else {
      for (let i = 0; i < 3; i++) {
        beam(tree, [0, 0.4, 0], [Math.sin(i * 2.4) * 0.27, 0.96, Math.cos(i * 2.4) * 0.23], 0.035, m.deck);
        mesh(crownGeometry, i === 1 ? m.sage : m.leaf, tree, [Math.sin(i * 2.4) * 0.28, 1.05 + i * 0.09, Math.cos(i * 2.4) * 0.24], [0.45, 0.39, 0.38]);
      }
    }
    terrainBounds.push(new THREE.Box3().setFromObject(tree));
  }
  tree(-1, -3, 0.1, -0.12, 0.95);
  tree(0, -3, -0.32, 0.1, 1.1);
  tree(-3, 0, -0.8, 0.1, 1);
  tree(-3, 2, -0.25, 0.1, 0.95);
  tree(3, -1, 0, -0.15, 1.05);
  tree(-2, 3, -0.25, 0.1, 1.15);

  const grassGeometry = ownGeometry(new THREE.BufferGeometry());
  grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.07, 0, 0, 0, 0.22, 0.01, 0.045, 0, 0, 0, 0, -0.06, 0.01, 0.17, 0, 0, 0, 0.06], 3));
  grassGeometry.computeVertexNormals();
  const grassPlacements: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  for (const { q, r, point, top } of tiles) {
    if (noise(q + 11, r + 3) < 0.38) continue;
    for (let i = 0; i < 13; i++) {
      const x = point.x + (noise(q * 13 + i, r) - 0.5) * 1.25;
      const z = point.z + (noise(r * 17 + i, q) - 0.5) * 1.25;
      const position = new THREE.Vector3(x, top, z);
      if (distanceToCorridor(position) < 0.65 || [...nodeMap.values()].some(({ point: station }) => station.distanceTo(position) < 1.9)) continue;
      if (noise(q + i, r + 5) < 0.18) {
        const shrub = mesh(crownGeometry, m.sage, island, [x, top + 0.15, z], [0.24, 0.22, 0.23]);
        shrub.rotation.y = i;
        if (i % 3 === 0) for (let j = 0; j < 3; j++) mesh(sphereGeometry, m.flower, island, [x + Math.sin(j * 2.4) * 0.13, top + 0.32, z + Math.cos(j * 2.4) * 0.12], [0.045, 0.025, 0.045]);
      } else {
        transform.position.set(x, top + 0.01, z);
        transform.rotation.set(0, i * 2.4, 0);
        transform.scale.setScalar(0.7 + noise(i, q + r));
        transform.updateMatrix();
        grassPlacements.push(transform.matrix.clone());
      }
    }
  }
  const meadow = new THREE.InstancedMesh(grassGeometry, m.grass, grassPlacements.length);
  instances.push(meadow);
  grassPlacements.forEach((matrix, i) => meadow.setMatrixAt(i, matrix));
  meadow.receiveShadow = true;
  island.add(meadow);

  function pitchedRoof(parent: THREE.Object3D, x: number, y: number, z: number, width: number, depth: number, mat: THREE.Material): void {
    const rise = width * 0.42;
    for (const side of [-1, 1]) {
      const roof = box(parent, mat, [x + side * width / 4, y + rise / 2, z], [Math.hypot(width / 2, rise), 0.08, depth]);
      roof.rotation.z = -side * Math.atan2(rise, width / 2);
    }
  }
  function planter(parent: THREE.Object3D, x: number, z: number, length = 0.65, greenhouse = false) {
    box(parent, m.deck, [x, 0.11, z], [length, 0.18, 0.3]);
    box(parent, m.soil, [x, 0.21, z], [length * 0.9, 0.025, 0.25]);
    const group = new THREE.Group();
    group.name = greenhouse ? 'greenhouse-crops' : 'garden-crops';
    parent.add(group);
    const count = Math.max(2, Math.floor(length / 0.22));
    for (let i = 0; i < count; i++) {
      const px = x - length * 0.32 + i * length * 0.64 / (count - 1);
      cylinder(group, m.leaf, [px, 0.35, z], 0.018, 0.28);
      for (let j = 0; j < 3; j++) {
        const leaf = mesh(sphereGeometry, m.leaf, group, [px + Math.sin(j * 2.4) * 0.09, 0.32 + j * 0.07, z + Math.cos(j * 2.4) * 0.07], [0.14, 0.055, 0.075]);
        leaf.rotation.z = j % 2 ? -0.5 : 0.5;
      }
    }
    if (greenhouse) plantGroups.push(group);
  }
  function habitat(parent: THREE.Object3D, x: number, z: number, width = 1.15, height = 1.1) {
    box(parent, m.dark, [x, 0.06, z], [width + 0.12, 0.12, 1.05]);
    box(parent, m.cream, [x, height / 2, z], [width, height, 0.95]);
    const roof = box(parent, m.metal, [x, height + 0.055, z], [width + 0.16, 0.12, 1.1]);
    roof.rotation.x = -0.06;
    const panel = box(parent, m.solar, [x - width * 0.08, height + 0.14, z - 0.05], [width * 0.7, 0.035, 0.7]);
    panel.rotation.x = -0.06;
    for (let i = 0; i < 4; i++) box(parent, m.metal, [x - width * 0.34 + i * width * 0.18, height + 0.165, z - 0.05], [0.012, 0.012, 0.69]);
    for (const side of [-1, 1]) {
      box(parent, m.metal, [x + side * (width / 2 - 0.035), height / 2, z + 0.49], [0.065, height, 0.045]);
      box(parent, m.rust, [x + side * width * 0.29, 0.17, z + 0.48], [width * 0.2, 0.035, 0.02]);
    }
    for (const side of [-1, 1]) {
      box(parent, m.window, [x + side * width * 0.29, height * 0.6, z + 0.487], [width * 0.19, 0.25, 0.03]);
      box(parent, m.cream, [x + side * width * 0.29, height * 0.6, z + 0.51], [0.025, 0.25, 0.025]);
    }
    box(parent, m.dark, [x, 0.3, z + 0.49], [0.25, 0.6, 0.035]);
    box(parent, m.dark, [x + width * 0.35, height + 0.15, z + 0.27], [0.2, 0.17, 0.24]);
    for (let i = 0; i < 3; i++) box(parent, m.metal, [x + width * 0.35, height + 0.15 + i * 0.035, z + 0.4], [0.14, 0.012, 0.02]);
    beam(parent, [x - width / 2 - 0.04, 0.18, z - 0.3], [x - width / 2 - 0.04, height * 0.7, z - 0.3], 0.035, m.rust);
    beam(parent, [x - width / 2 - 0.04, height * 0.7, z - 0.3], [x - width / 2 - 0.04, height * 0.7, z + 0.1], 0.035, m.rust);
    box(parent, m.cyan, [x + width * 0.19, height * 0.73, z + 0.51], [0.07, 0.035, 0.025]);
  }

  for (const node of nodeMap.values()) {
    const group = new THREE.Group();
    group.name = node.id;
    group.position.copy(node.point);
    settlement.add(group);
    const large = node.id === 'greenhouse';
    const pickTarget = box(group, m.dark, [0, 0.7, -0.5], [large ? 2.2 : 1.9, 1.8, large ? 2.2 : 1.8]);
    pickTarget.visible = false;
    pickTarget.userData.nodeId = node.id;
    pickables.push(pickTarget);
    const selectRing = ring(group, [0, 0.08, -0.4], large ? 1.45 : 1.15, selectionMaterial);
    selectRing.visible = false;
    selectionRings.set(node.id, selectRing);

    if (node.id === 'dock') {
      habitat(group, -1.08, -0.45, 0.9, 0.85);
      box(group, m.supplyWindow, [-0.83, 0.54, 0.05], [0.22, 0.24, 0.025]);
      supplyLamp = box(group, m.warm, [-1.08, 0.76, 0.08], [0.17, 0.045, 0.045]);
      supplyLamp.visible = false;
      for (let i = 0; i < 13; i++) box(group, m.deck, [-0.9, -0.04, -0.95 + i * 0.24], [0.8, 0.1, 0.21]);
      for (const z of [-0.95, 1.95]) cylinder(group, m.dark, [-1.16, 0.15, z], 0.06, 0.5);
      ring(group, [-1.25, 0.32, -0.45], 0.16, m.cream).rotation.x = 0;
      for (const z of [0.7, 1.8]) {
        cylinder(group, m.dark, [-1.16, 0.06, z], 0.075, 0.12);
        beam(group, [-1.3, 0.1, z], [-1.02, 0.1, z], 0.035, m.metal);
      }
      beam(group, [-1.2, 0.16, 1.8], [-2.2, -0.15, 1.3], 0.018, m.cream);
      const ferry = new THREE.Group();
      ferry.name = 'Neri-ferry';
      ferry.position.set(-2.45, -0.58, 0.95);
      group.add(ferry);
      const hull = mesh(ownGeometry(new THREE.CylinderGeometry(1, 0.83, 0.4, 8)), m.dark, ferry, [0, 0, 0], [0.47, 1, 1.12]);
      hull.rotation.y = Math.PI / 8;
      box(ferry, m.deck, [0, 0.21, 0], [0.68, 0.06, 1.65]);
      box(ferry, m.cream, [0, 0.45, -0.35], [0.61, 0.46, 0.64]);
      box(ferry, m.window, [0, 0.52, 0], [0.47, 0.22, 0.025]);
      box(ferry, m.metal, [0, 0.71, -0.35], [0.72, 0.08, 0.75]);
      beam(ferry, [0.2, 0.72, -0.4], [0.2, 1.13, -0.4], 0.017, m.dark);
      box(ferry, m.orange, [0, 0.3, 0.48], [0.39, 0.15, 0.35]);
      for (const x of [-0.34, 0.34]) beam(ferry, [x, 0.39, 0.1], [x, 0.39, 0.8], 0.018, m.cream);
      const scanner = new THREE.Group();
      scanner.position.set(-0.9, 0, 1.18);
      group.add(scanner);
      for (const x of [-0.28, 0.28]) box(scanner, m.metal, [x, 0.33, 0], [0.06, 0.67, 0.07]);
      box(scanner, m.cyan, [0, 0.68, 0], [0.61, 0.07, 0.1]);
      box(scanner, m.black, [-0.38, 0.35, 0.05], [0.17, 0.23, 0.07]);
      supplyPallet = new THREE.Group();
      supplyPallet.name = 'restored-supply-pallet';
      supplyPallet.position.set(-0.24, 0, -0.4);
      group.add(supplyPallet);
      for (const x of [-0.17, 0, 0.17]) box(supplyPallet, m.deck, [x, 0.04, 0], [0.14, 0.08, 0.4]);
      for (let i = 0; i < 3; i++) {
        box(supplyPallet, m.cargo, [(i % 2 - 0.5) * 0.21, 0.16 + Math.floor(i / 2) * 0.22, 0], [0.2, 0.2, 0.28]);
        box(supplyPallet, m.cyan, [(i % 2 - 0.5) * 0.21, 0.16 + Math.floor(i / 2) * 0.22, 0.145], [0.07, 0.04, 0.01]);
      }
      supplyPallet.visible = false;
    } else if (node.id === 'relay') {
      habitat(group, 0, -0.65, 0.95, 0.8);
      beam(group, [0, 0.8, -0.65], [0, 2.25, -0.65], 0.04, m.dark);
      beam(group, [-0.36, 1.9, -0.65], [0.36, 1.9, -0.65], 0.025, m.dark);
      for (const x of [-0.27, 0.27]) beam(group, [x, 0.8, -0.8], [0, 2.2, -0.65], 0.017, m.metal);
      box(group, m.dark, [0.67, 0.25, -0.8], [0.3, 0.5, 0.4]);
      box(group, m.cyan, [0.67, 0.38, -0.59], [0.2, 0.035, 0.02]);
      const dish = new THREE.Group();
      dish.position.set(0, 1.65, -0.65);
      dish.rotation.set(-0.7, 0, -0.3);
      group.add(dish);
      const profile: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const radius = i / 12 * 0.48;
        profile.push(new THREE.Vector2(radius, radius * radius * 0.58));
      }
      mesh(ownGeometry(new THREE.LatheGeometry(profile, 24)), m.cream, dish);
      beam(dish, [0, 0, 0], [0, 0.45, 0], 0.02, m.rust);
    } else if (node.id === 'junction') {
      habitat(group, 0, -0.72, 1.4, 1.05);
      box(group, m.deck, [0, 0.04, -0.12], [0.7, 0.08, 0.35]);
      cylinder(group, m.deck, [0.2, 0.4, 0.05], 0.035, 0.8);
      box(group, m.cream, [0.2, 0.66, 0.05], [0.44, 0.15, 0.07]);
      box(group, m.dark, [-0.55, 0.5, -0.18], [0.36, 0.48, 0.13]);
      for (let i = 0; i < 3; i++) box(group, m.cyan, [-0.55, 0.38 + i * 0.1, -0.105], [0.24, 0.025, 0.015]);
    } else if (node.id === 'observatory') {
      cylinder(group, m.cream, [0, 0.45, -0.6], 0.7, 0.9);
      cylinder(group, m.rust, [0, 0.9, -0.6], 0.73, 0.09);
      const dome = mesh(ownGeometry(new THREE.SphereGeometry(0.71, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), m.sage, group, [0, 0.95, -0.6]);
      box(group, m.dark, [0.18, 1.42, -0.28], [0.19, 0.08, 0.56]);
      beam(group, [0.18, 1.4, -0.25], [0.18, 1.66, 0.32], 0.11, m.cream);
      beam(group, [0.18, 1.66, 0.32], [0.18, 1.69, 0.4], 0.09, m.black);
      dome.rotation.y = 0.2;
      for (const x of [-0.65, 0.65]) beam(group, [x, 0.98, -0.6], [x * 0.48, 1.52, -0.6], 0.022, m.cream);
      for (const x of [-0.36, 0.36]) box(group, m.window, [x, 0.5, 0.03], [0.18, 0.27, 0.04]);
      box(group, m.dark, [0, 0.26, 0.12], [0.23, 0.52, 0.03]);
    } else if (node.id === 'garden') {
      habitat(group, 0.85, -0.8, 0.7, 0.7);
      for (const z of [-0.9, -0.35, 0.2]) planter(group, -0.45, z, 1.1);
      cylinder(group, m.metal, [1.2, 0.38, -0.1], 0.22, 0.75);
      for (const z of [-0.9, -0.35, 0.2]) beam(group, [-0.98, 0.24, z], [-0.1, 0.24, z], 0.018, m.dark);
      beam(group, [1.2, 0.7, -0.1], [0.85, 0.7, -0.1], 0.03, m.rust);
    } else if (node.id === 'greenhouse') {
      box(group, m.cream, [0, 0.12, -0.62], [1.9, 0.24, 1.75]);
      box(group, m.greenhouseWindow, [0, 0.25, -0.62], [1.73, 0.08, 1.59]);
      for (const x of [-0.9, 0.9]) box(group, m.glass, [x, 0.69, -0.62], [0.02, 0.9, 1.7]);
      for (const z of [-1.47, 0.23]) box(group, m.glass, [0, 0.69, z], [1.8, 0.9, 0.02]);
      pitchedRoof(group, 0, 1.14, -0.62, 1.85, 1.78, m.glass);
      for (const z of [-1.47, -0.62, 0.23]) {
        for (const x of [-0.9, 0.9]) {
          beam(group, [x, 0.24, z], [x, 1.14, z], 0.026, m.cream);
          beam(group, [x, 1.14, z], [0, 1.92, z], 0.026, m.cream);
        }
      }
      beam(group, [0, 1.92, -1.52], [0, 1.92, 0.28], 0.035, m.cream);
      for (const x of [-0.9, 0.9]) beam(group, [x, 1.14, -1.47], [x, 1.14, 0.23], 0.026, m.cream);
      for (const z of [-1.18, -0.68, -0.18]) planter(group, 0, z, 1.35, true);
      greenhouseShutters = new THREE.Group();
      group.add(greenhouseShutters);
      for (const x of [-1, 1]) box(greenhouseShutters, m.sage, [x * 0.21, 0.64, 0.25], [0.42, 0.76, 0.05]);
      box(group, m.cream, [0, 1.06, 0.25], [0.92, 0.08, 0.08]);
      box(group, m.rust, [0, 0.08, 0.46], [0.8, 0.12, 0.35]);
      greenhouseLight = new THREE.PointLight('#ffae60', 0, 6, 2);
      greenhouseLight.name = 'greenhouse-light';
      greenhouseLight.position.set(0, 1.1, -0.62);
      group.add(greenhouseLight);
      greenhouseGlow = box(group, m.warm, [0, 1.1, -0.62], [0.65, 0.06, 0.08]);
      greenhouseGlow.visible = false;
      box(group, m.metal, [1.13, 0.42, -1.05], [0.32, 0.66, 0.55]);
      box(group, m.dark, [1.3, 0.46, -1.05], [0.025, 0.37, 0.35]);
      for (let i = 0; i < 4; i++) box(group, m.metal, [1.32, 0.31 + i * 0.085, -1.05], [0.025, 0.025, 0.32]);
      beam(group, [1.12, 0.22, -1.05], [1.12, 0.22, -0.2], 0.035, m.rust);
      beam(group, [1.12, 0.22, -0.2], [0.9, 0.22, -0.2], 0.035, m.rust);
    }
    const lampX = node.id === 'dock' ? -1.22 : node.id === 'garden' ? 0.85 : -0.73;
    const lampZ = node.id === 'dock' ? 1.8 : -1.05;
    beam(group, [lampX, 0, lampZ], [lampX, 0.9, lampZ], 0.025, m.dark);
    box(group, m.warm, [lampX, 0.91, lampZ], [0.13, 0.09, 0.13]);
    box(group, m.metal, [lampX, 0.98, lampZ], [0.19, 0.045, 0.19]);
    const lamp = new THREE.PointLight(PALETTE.light, 0.25, 2.8, 2);
    lamp.position.set(lampX, 0.87, lampZ);
    group.add(lamp);
    fieldLamps.push(lamp);
    const [offsetX, offsetZ] = LANDMARK_OFFSETS[node.id] || [0, 0];
    const bounds = new THREE.Box3();
    group.updateWorldMatrix(true, false);
    for (const child of group.children) {
      if (child === pickTarget || child === selectRing) continue;
      child.position.x += offsetX;
      child.position.z += offsetZ;
      bounds.union(new THREE.Box3().setFromObject(child));
    }
    if (!bounds.isEmpty()) {
      bounds.getCenter(node.labelPoint);
      node.labelPoint.y = node.point.y;
      node.labelPoint.z = bounds.max.z + 0.4;
      bounds.expandByPoint(node.point);
      pickTarget.position.copy(bounds.getCenter(new THREE.Vector3()).sub(node.point));
      pickTarget.scale.copy(bounds.getSize(new THREE.Vector3()).addScalar(0.15));
    }
    stationBounds.set(node.id, new THREE.Box3().setFromObject(group));
  }

  const missionFootprints = new THREE.Group();
  missionFootprints.name = 'mission-footprints';
  settlement.add(missionFootprints);
  const missionMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#f5c77d', transparent: true, opacity: 0.95, depthWrite: false }));
  const missionRing = ring(missionFootprints, [0, 0.365, 0], 1, missionMaterial);
  missionRing.name = 'active-mission-footprint';
  missionRing.castShadow = missionRing.receiveShadow = false;

  function bridge(from: string, to: string, broken = false) {
    const a = nodeMap.get(from)?.point;
    const b = nodeMap.get(to)?.point;
    if (!a || !b) return;
    const direction = b.clone().sub(a).normalize();
    const start = a.clone().addScaledVector(direction, broken ? 0.55 : 0);
    const end = b.clone().addScaledVector(direction, broken ? -0.55 : 0);
    const length = start.distanceTo(end);
    const group = new THREE.Group();
    group.position.copy(start.clone().add(end).multiplyScalar(0.5));
    group.rotation.y = Math.atan2(direction.x, direction.z);
    group.userData.edge = [from, to];
    group.userData.broken = broken;
    settlement.add(group);
    if (!broken) {
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const keySeed = [...edgeKey(from, to)].reduce((seed, letter) => seed + letter.charCodeAt(0), 0);
      const pathColor = new THREE.Color();
      const segments = 24;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const taper = Math.sin(Math.PI * t);
        const left = 0.22 + taper * (0.025 + noise(keySeed, i) * 0.07);
        const right = 0.22 + taper * (0.025 + noise(i, keySeed) * 0.07);
        for (const [j, x] of [-left, -0.17, 0.17, right].entries()) {
          positions.push(x, j === 0 || j === 3 ? 0.012 : 0.045, (t - 0.5) * length);
          pathColor.set(j === 0 || j === 3 ? '#90967a' : '#c4b79a').multiplyScalar(0.92 + noise(keySeed + j, i * 3) * 0.15);
          colors.push(pathColor.r, pathColor.g, pathColor.b);
        }
        if (i < segments) for (let j = 0; j < 3; j++) {
          const a = i * 4 + j, b = a + 4;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const geometry = ownGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const path = mesh(geometry, pathMaterial, group);
      path.castShadow = false;
      return;
    }
    const segments: [number, number][] = [[-length / 2, -length * 0.17], [length * 0.17, length / 2]];
    for (const [low, high] of segments) {
      const span = high - low;
      const middle = (high + low) / 2;
      box(group, m.dark, [0, -0.01, middle], [0.52, 0.1, span]);
      for (let z = low + 0.06; z < high; z += 0.18) box(group, m.deck, [0, 0.06, z], [0.56, 0.06, 0.15]);
      for (const x of [-0.29, 0.29]) {
        beam(group, [x, 0.35, low], [x, 0.35, high], 0.022, m.deck);
        const count = Math.max(1, Math.ceil(span / 0.9));
        for (let i = 0; i <= count; i++) {
          const z = low + span * i / count;
          beam(group, [x, -0.12, z], [x, 0.38, z], 0.025, m.deck);
        }
      }
      const cut = low < 0 ? high : low;
      box(group, m.rust, [0, 0.29, cut], [0.64, 0.16, 0.06]);
      beam(group, [-0.24, 0.07, cut], [0.2, 0.46, cut], 0.035, m.cream);
      const plank = box(group, m.deck, [0.13, -0.1, cut + (low < 0 ? 0.24 : -0.24)], [0.23, 0.055, 0.48]);
      plank.rotation.set(low < 0 ? 0.55 : -0.45, 0.2, 0.15);
    }
  }
  const pathMaterial = material('#ffffff', { vertexColors: true });
  pathMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 pathPoint;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 pathPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        pathPosition=instanceMatrix*pathPosition;
      #endif
      pathPoint=(modelMatrix*pathPosition).xz;`);
    shader.fragmentShader = `varying vec2 pathPoint;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 grainCell=floor(pathPoint*24.);
      vec3 grain=fract(sin(vec3(dot(grainCell,vec2(127.1,311.7)),dot(grainCell,vec2(269.5,183.3)),dot(grainCell,vec2(419.2,371.9))))*43758.5453);
      vec2 grainOffset=fract(pathPoint*24.)-(.25+grain.xy*.5);
      float gravel=1.-smoothstep(.07,.22,length(grainOffset));
      float grainFade=1.-smoothstep(.45,1.2,length(fwidth(pathPoint*24.)));
      diffuseColor.rgb*=1.+(grain.z-.5)*.24*gravel*grainFade;`);
  };
  for (const [a, b] of edges || []) if (edgeKey(a, b) !== blockedKey) bridge(a, b);
  if (blockedEdge) bridge(...blockedEdge, true);

  const drone = new THREE.Group();
  drone.name = 'Pip';
  scene.add(drone);
  box(drone, m.cream, [0, 0, 0], [0.42, 0.24, 0.5]);
  box(drone, m.orange, [0, 0.15, -0.04], [0.29, 0.13, 0.3]);
  box(drone, m.black, [0, 0.025, 0.26], [0.31, 0.12, 0.025]);
  box(drone, m.warm, [0, 0.025, 0.277], [0.22, 0.045, 0.018]);
  for (const x of [-0.3, 0.3]) {
    beam(drone, [0, 0, 0], [x, -0.06, 0], 0.035, m.metal);
    ring(drone, [x, 0.02, 0], 0.13, m.dark);
    cylinder(drone, m.dark, [x, 0.02, 0], 0.035, 0.07);
    box(drone, m.sage, [x, 0.035, 0], [0.22, 0.018, 0.035]);
  }
  const droneHalo = ring(drone, [0, -0.3, 0], 0.47, m.sage);
  const dockPoint = nodeMap.get('dock')?.point || nodeMap.values().next().value?.point || new THREE.Vector3();
  const dronePosition = dockPoint.clone().setY(1.05);
  drone.position.copy(dronePosition);
  let droneYaw = 0;

  const intake = new THREE.Group();
  intake.name = 'receipt-intake';
  intake.position.copy(dockPoint);
  scene.add(intake);
  const cargo = new THREE.Group();
  cargo.name = 'incoming-cargo';
  intake.add(cargo);
  const crateBody = box(cargo, m.cargo, [0, 0, 0], [0.32, 0.3, 0.38]);
  const receipt = box(cargo, m.cream, [0, 0.02, 0.197], [0.14, 0.12, 0.015]);
  box(cargo, m.dark, [0, 0.02, 0.209], [0.085, 0.018, 0.012]);
  const rejection = beam(cargo, [-0.14, -0.13, 0.22], [0.14, 0.13, 0.22], 0.023, m.rust);
  const cargoSlots = new THREE.Group();
  intake.add(cargoSlots);
  const storedCrates: THREE.Object3D[] = [];
  const rejectedCrates: THREE.Object3D[] = [];
  for (let i = 0; i < 12; i++) {
    const acceptedCrate = new THREE.Group();
    acceptedCrate.name = 'accepted-cargo';
    acceptedCrate.position.set(-0.92 + (i % 2) * 0.18, 0.17 + Math.floor(i / 4) * 0.18, 0.32 + Math.floor(i % 4 / 2) * 0.2);
    box(acceptedCrate, m.cargo, [0, 0, 0], [0.16, 0.16, 0.18]);
    box(acceptedCrate, m.cyan, [0, 0, 0.095], [0.07, 0.04, 0.01]);
    acceptedCrate.visible = false;
    cargoSlots.add(acceptedCrate);
    storedCrates.push(acceptedCrate);
    const ghost = new THREE.Group();
    ghost.name = 'duplicate-scan';
    ghost.position.set(-1.6 - (i % 3) * 0.23, 0.12, 2.06 + Math.floor(i / 3) * 0.18);
    box(ghost, m.ghost, [0, 0, 0], [0.19, 0.19, 0.17]);
    beam(ghost, [-0.08, -0.08, 0.09], [0.08, 0.08, 0.09], 0.012, m.rust);
    ghost.visible = false;
    cargoSlots.add(ghost);
    rejectedCrates.push(ghost);
  }
  cargo.visible = false;
  terrainBounds.push(new THREE.Box3(new THREE.Vector3(dockPoint.x - 3.1, -0.5, dockPoint.z + 0.5), new THREE.Vector3(dockPoint.x - 0.4, 1, dockPoint.z + 2.8)));

  const changingObjects = new Set<THREE.Object3D>([
    missionFootprints, ...plantGroups, ...selectionRings.values(), ...pickables,
    ...[greenhouseShutters, greenhouseGlow, supplyPallet, supplyLamp].filter((object): object is THREE.Object3D => Boolean(object)),
  ]);
  const batches = new Map<string, THREE.Mesh[]>();
  settlement.updateMatrixWorld(true);
  settlement.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible || changingObjects.has(ancestor)) return;
    }
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    if (mats.some((mat) => mat.transparent)) return;
    const key = [object.geometry.uuid, ...mats.map((mat) => mat.uuid), object.castShadow, object.receiveShadow].join('|');
    const batch = batches.get(key) || [];
    batch.push(object);
    batches.set(key, batch);
  });
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const first = objects[0];
    const batch = new THREE.InstancedMesh(first.geometry, first.material, objects.length);
    batch.name = 'static-settlement';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    objects.forEach((object, index) => {
      batch.setMatrixAt(index, object.matrixWorld);
      // Keep the source solids for station bounds and picking, without drawing them twice.
      object.layers.disableAll();
      object.matrixAutoUpdate = false;
    });
    batch.computeBoundingSphere();
    scene.add(batch);
    instances.push(batch);
  }

  const programDisplay = new THREE.Group();
  programDisplay.name = 'public-result-display';
  programDisplay.visible = false;
  scene.add(programDisplay);
  const programSlots = Array.from({ length: 4 }, (_, index) => {
    const group = new THREE.Group();
    group.position.x = (index - 1.5) * 0.36;
    programDisplay.add(group);
    const body = box(group, m.cyan, [0, 0.25, 0], [0.19, 0.5, 0.18]);
    const lamp = mesh(sphereGeometry, m.cyan, group, [0, 0.22, 0], [0.12, 0.12, 0.12]);
    const leaf = mesh(sphereGeometry, m.leaf, group, [0.09, 0.32, 0], [0.14, 0.045, 0.065]);
    for (const object of [body, lamp, leaf]) object.castShadow = object.receiveShadow = false;
    return { group, body, lamp, leaf };
  });
  const programCaption = document.createElement('div');
  programCaption.hidden = true;
  programCaption.style.cssText = 'position:absolute;left:10px;bottom:112px;max-width:calc(100% - 20px);color:#ffe4b1;background:rgba(33,55,52,.92);padding:4px 7px;border-radius:4px;pointer-events:none;font:500 12px/1.5 Manrope,sans-serif;';
  container.append(programCaption);
  type ProgramState = {
    missionId: ProgramPlayback['missionId']; caseId: string;
    frames: readonly ProgramFrame[]; index: number; elapsed: number; paused: boolean;
    completed: boolean; pendingComplete: boolean; visited: ProgramFrame[];
    onComplete?: () => void; detachAbort: () => void;
  };
  let activeProgram: ProgramState | null = null;
  const programEvents = new AbortController();

  function clearProgram(): void {
    activeProgram?.detachAbort();
    activeProgram = null;
    programDisplay.visible = false;
    labelsNeedProjection = true;
    programDisplay.userData = {};
    programCaption.hidden = true;
    clearProgramAttributes();
    noTrace();
  }
  function updateProgramControls(state: ProgramState): void {
    buttons[0].textContent = state.paused ? 'Resume' : 'Pause';
    buttons[0].disabled = state.completed && state.index === state.frames.length - 1;
    buttons[1].disabled = state.index === 0;
    buttons[2].disabled = state.index === state.frames.length - 1;
    buttons[3].disabled = !state.completed;
    buttons.forEach((button) => { button.style.opacity = button.disabled ? '0.5' : '1'; button.style.cursor = button.disabled ? 'default' : 'pointer'; });
    container.dataset.programState = state.completed ? 'complete' : state.paused ? 'paused' : 'playing';
    programStatus.textContent = `${missionCatalog[state.missionId].title}. Public case ${state.caseId}. Step ${state.index + 1} / ${state.frames.length}. ${state.completed ? 'Inspection only. Completion already consumed.' : 'Current submitted result.'}`;
  }
  function showProgramFrame(state: ProgramState): void {
    if (activeProgram !== state || disposed) return;
    const step = state.frames[state.index];
    state.elapsed = 0;
    if (!state.visited.some((frame) => frame.id === step.id)) state.visited.push(step);
    container.dataset.programTrace = JSON.stringify(state.visited);
    container.dataset.programProgress = String(state.index + 1);
    const heading = document.createElement('h4');
    heading.textContent = step.title;
    heading.style.cssText = 'font:600 14px/1.5 Manrope,sans-serif;margin:12px 0 4px;';
    const description = document.createElement('p');
    description.textContent = step.description;
    const marks = document.createElement('p');
    marks.textContent = step.marks.map((mark) => mark.label).join(' · ');
    const sources = document.createElement('p');
    sources.textContent = `Source indices ${JSON.stringify(step.sourceIndices)}. Up to four visual marks. Complete evidence follows.`;
    frameReader.replaceChildren(heading, description, marks, sources, ...step.evidence.flatMap((item) => {
      const label = document.createElement('div');
      label.textContent = `${item.label} · ${item.origin}`;
      const value = document.createElement('pre');
      value.style.cssText = outputReader.style.cssText;
      value.textContent = JSON.stringify(item.value, null, 2);
      return [label, value];
    }));
    programCaption.textContent = `${state.index + 1}/${state.frames.length} ${step.title} · ${step.marks.map((mark) => mark.label).join(' · ')}`;
    programDisplay.userData = { missionId: state.missionId, step: state.index + 1, marks: step.marks };
    programSlots.forEach(({ group, body, lamp, leaf }, index) => {
      const mark = step.marks[index];
      group.visible = Boolean(mark);
      if (!mark) return;
      const mat = mark.state === 'rejected' || mark.state === 'blocked' ? m.rust : mark.state === 'deleted' ? m.dark : mark.state === 'idle' ? m.metal : m.cyan;
      body.material = lamp.material = mat;
      body.visible = mark.form === 'bar' || mark.form === 'token' || mark.form === 'sprout';
      lamp.visible = mark.form === 'lamp' || mark.form === 'sprout';
      leaf.visible = mark.form === 'sprout' && mark.state !== 'idle' && mark.state !== 'rejected';
      const height = mark.form === 'bar' && mark.range && mark.value !== null
        ? 0.06 + 0.6 * Math.max(0, Math.min(1, (mark.value - mark.range[0]) / (mark.range[1] - mark.range[0])))
        : mark.form === 'sprout' ? mark.state === 'idle' ? 0.08 : mark.state === 'complete' ? 0.62 : mark.state === 'rejected' ? 0.12 : 0.3 + (mark.value ?? 0) * 0.08 : 0.23;
      body.scale.set(mark.form === 'sprout' ? 0.045 : 0.19, height, 0.15);
      body.position.y = height / 2;
      lamp.position.y = mark.form === 'sprout' ? height : 0.22;
      lamp.scale.setScalar(mark.form === 'sprout' ? 0.06 : 0.12);
      leaf.position.y = height * 0.8;
    });
    if (state.index === state.frames.length - 1 && !state.completed) state.pendingComplete = true;
    updateProgramControls(state);
  }
  function playProgram(sample: ProgramPlayback, { onComplete, signal }: ProgramPlaybackOptions): void {
    if (disposed) return;
    activeRoute = null;
    clearIntake();
    clearProgram();
    if (signal?.aborted) return;
    let frames: readonly ProgramFrame[];
    try { frames = buildProgramPlayback(sample); }
    catch (error) {
      programStatus.textContent = error instanceof Error ? error.message : 'Result playback unavailable. Cannot construct result frames.';
      throw error;
    }
    const state: ProgramState = { missionId: sample.missionId, caseId: sample.caseId, frames, index: 0, elapsed: 0, paused: false, completed: false, pendingComplete: false, visited: [], onComplete, detachAbort: () => signal?.removeEventListener('abort', abort) };
    function abort() { if (activeProgram === state) clearProgram(); }
    activeProgram = state;
    signal?.addEventListener('abort', abort, { once: true });
    container.dataset.programMission = sample.missionId;
    container.dataset.programResult = JSON.stringify(sample.output);
    programReader.dataset.caseId = sample.caseId;
    outputReader.textContent = `Actual returned output\n${JSON.stringify(sample.output, null, 2)}`;
    const bounds = stationBounds.get(missionCatalog[sample.missionId].focus)!;
    programDisplay.position.copy(bounds.getCenter(new THREE.Vector3()));
    programDisplay.position.y = Math.max(2.1, bounds.max.y + 0.25);
    programDisplay.position.z = bounds.max.z + 0.35;
    programDisplay.visible = true;
    labelsNeedProjection = true;
    programCaption.hidden = false;
    previousTime = performance.now();
    showProgramFrame(state);
  }
  buttons[0].addEventListener('click', () => {
    const state = activeProgram;
    if (!state || state.completed && state.index === state.frames.length - 1) return;
    state.paused = !state.paused;
    previousTime = performance.now();
    updateProgramControls(state);
  }, { signal: programEvents.signal });
  for (const [button, direction] of [[buttons[1], -1], [buttons[2], 1]] as const) button.addEventListener('click', () => {
    const state = activeProgram;
    if (!state) return;
    state.paused = true;
    state.pendingComplete = false;
    state.index = Math.max(0, Math.min(state.frames.length - 1, state.index + direction));
    showProgramFrame(state);
  }, { signal: programEvents.signal });
  buttons[3].addEventListener('click', () => {
    const state = activeProgram;
    if (!state?.completed) return;
    state.index = 0;
    state.paused = false;
    previousTime = performance.now();
    showProgramFrame(state);
  }, { signal: programEvents.signal });
  function updateProgram(delta: number): void {
    const state = activeProgram;
    if (!state || state.paused || state.index === state.frames.length - 1) return;
    state.elapsed += delta;
    if (state.elapsed < 0.8) return;
    state.index++;
    showProgramFrame(state);
  }
  function finishRenderedProgram(): void {
    const state = activeProgram;
    if (!state?.pendingComplete || state.completed) return;
    state.pendingComplete = false;
    state.completed = true;
    state.detachAbort();
    state.detachAbort = () => {};
    const callback = state.onComplete;
    state.onComplete = undefined;
    updateProgramControls(state);
    if (activeProgram === state && !disposed) callback?.();
  }

  let activeIntake: IntakeState | null = null;
  let intakeTrace: Pick<IntakeRow, 'receiptId' | 'decision' | 'units'>[] = [];
  let deliveredUnits = 0;
  let acceptedCount = 0;
  let duplicateCount = 0;
  const cargoIncoming = new THREE.Vector3(-1.65, 0.2, 1.82);
  const cargoScanner = new THREE.Vector3(-0.9, 0.2, 1.18);
  const cargoStorage = new THREE.Vector3(-0.87, 0.2, 0.4);
  const cargoOutside = new THREE.Vector3(-1.65, 0.2, 2.06);

  function clearIntake(): void {
    activeIntake = null;
    intakeTrace = [];
    deliveredUnits = acceptedCount = duplicateCount = 0;
    cargo.visible = false;
    storedCrates.forEach((crate) => { crate.visible = false; });
    rejectedCrates.forEach((crate) => { crate.visible = false; });
    container.dataset.intakeTrace = '[]';
    container.dataset.deliveredUnits = '0';
    container.dataset.intakeActive = 'false';
    container.dataset.intakeProgress = '0';
  }

  function playDeliveries(deliveries: readonly DeliveryParcel[], accepted: readonly DeliveryParcel[], { onComplete }: DeliveryPlaybackOptions = {}): void {
    if (disposed) return;
    clearProgram();
    shadowsDirty = true;
    previousTime = performance.now();
    activeRoute = null;
    clearIntake();
    const remaining = accepted.map((row) => ({ ...row }));
    const scanned = new Set<string>();
    const decisions: IntakeRow[] = deliveries.map((row) => {
      const index = scanned.has(row.receiptId) ? -1 : remaining.findIndex((candidate) => candidate.receiptId === row.receiptId && candidate.item === row.item && candidate.units === row.units);
      scanned.add(row.receiptId);
      const decision = index >= 0 ? 'accepted' : 'duplicate';
      if (index >= 0) remaining.splice(index, 1);
      return { ...row, decision };
    });
    activeIntake = { rows: decisions, index: 0, progress: 0, onComplete };
    container.dataset.intakeActive = 'true';
  }

  function updateIntake(delta: number): void {
    const playback = activeIntake;
    if (!playback) return;
    while (activeIntake === playback) {
      const row = playback.rows[playback.index];
      if (!row) {
        activeIntake = null;
        cargo.visible = false;
        container.dataset.intakeActive = 'false';
        playback.onComplete?.();
        return;
      }
      const duration = reducedMotion ? 0.045 : 0.76;
      const step = Math.min(delta, (1 - playback.progress) * duration);
      delta -= step;
      playback.progress = Math.min(1, playback.progress + step / duration);
      if (playback.progress > 1 - 1e-9) playback.progress = 1;
      const progress = playback.progress;
      const destination = row.decision === 'accepted' ? cargoStorage : cargoOutside;
      const fraction = progress < 0.45 ? progress / 0.45 : (progress - 0.45) / 0.55;
      cargo.position.lerpVectors(progress < 0.45 ? cargoIncoming : cargoScanner, progress < 0.45 ? cargoScanner : destination, fraction * fraction * (3 - 2 * fraction));
      cargo.visible = true;
      const rejected = progress >= 0.45 && row.decision === 'duplicate';
      crateBody.material = rejected ? m.ghost : m.cargo;
      receipt.material = rejected ? m.ghost : m.cream;
      rejection.visible = rejected;
      container.dataset.intakeProgress = String(playback.index + progress);
      if (progress === 1) {
        intakeTrace.push({ receiptId: row.receiptId, decision: row.decision, units: row.units });
        if (row.decision === 'accepted') {
          deliveredUnits += row.units;
          if (storedCrates[acceptedCount]) storedCrates[acceptedCount].visible = true;
          acceptedCount++;
        } else {
          if (rejectedCrates[duplicateCount]) rejectedCrates[duplicateCount].visible = true;
          duplicateCount++;
        }
        container.dataset.deliveredUnits = String(deliveredUnits);
        container.dataset.intakeTrace = JSON.stringify(intakeTrace);
        playback.index++;
        playback.progress = 0;
      }
      if (delta <= 0 && playback.index < playback.rows.length) return;
    }
  }

  const trailGeometry = ownGeometry(new THREE.BufferGeometry());
  const trailPositions = new Float32Array(900 * 3);
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeometry, ownMaterial(new THREE.LineBasicMaterial({ color: PALETTE.light, transparent: true, opacity: 0.85 })));
  trail.frustumCulled = false;
  scene.add(trail);
  let trailCount = 0;
  let lastTrailPoint = new THREE.Vector3(Infinity, Infinity, Infinity);
  function addTrail(point: THREE.Vector3): void {
    if (trailCount >= 900 || point.distanceToSquared(lastTrailPoint) < 0.012) return;
    trailPositions.set([point.x, point.y - 0.12, point.z], trailCount++ * 3);
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.setDrawRange(0, trailCount);
    lastTrailPoint.copy(point);
  }

  const labelsLayer = document.createElement('div');
  labelsLayer.className = 'world-labels';
  labelsLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  container.append(labelsLayer);
  const labels: { element: HTMLDivElement; node: SceneNode; point: THREE.Vector3 }[] = [];
  let presentation: PresentationMode = 'work';
  let mapVisible = false;
  let selectedId: string | null = null;
  let width = 1;
  let height = 1;
  let drawable = false;
  let labelsNeedProjection = true;
  container.dataset.presentation = presentation;
  container.dataset.mapVisible = 'false';
  for (const node of nodeMap.values()) {
    const label = document.createElement('div');
    label.className = 'world-label';
    label.dataset.nodeId = node.id;
    label.textContent = node.label || node.id;
    label.style.cssText = 'position:absolute;left:0;top:0;color:#f4efdf;font:500 12px/1.4 Manrope,sans-serif;white-space:nowrap;padding:4px 7px;background:rgba(39,62,52,.9);border:1px solid transparent;border-radius:5px;will-change:transform;pointer-events:none;';
    labelsLayer.append(label);
    labels.push({ element: label, node, point: node.labelPoint });
  }
  const warningLabel = document.createElement('div');
  warningLabel.className = 'world-label world-label-warning';
  warningLabel.textContent = '× Bridge broken';
  warningLabel.style.cssText = 'position:absolute;left:0;top:0;color:#f4d2aa;font:500 12px/1.4 Manrope,sans-serif;white-space:nowrap;padding:4px 7px;background:rgba(64,57,44,.92);border:1px dashed #c39766;border-radius:5px;pointer-events:none;';
  labelsLayer.append(warningLabel);
  function contextBadge(kind: 'active' | 'locked' | 'planned', point: THREE.Vector3, text: string) {
    const element = document.createElement('div');
    element.className = 'world-region-label';
    element.dataset.regionKind = kind;
    element.textContent = text;
    element.style.cssText = `position:absolute;left:0;top:0;color:${kind === 'active' ? '#ffe4b1' : '#e0e8d9'};font:600 12px/1.4 Manrope,sans-serif;white-space:pre;padding:4px 7px;background:rgba(33,55,52,.93);border:1px ${kind === 'planned' ? 'dashed' : 'solid'} ${kind === 'active' ? '#edbd73' : '#91aaa0'};border-radius:4px;pointer-events:none;z-index:2;`;
    labelsLayer.append(element);
    return { element, point };
  }
  const activeBadge = contextBadge('active', new THREE.Vector3(), missionContext.activeLabel);
  const plannedBadge = contextBadge('planned', new THREE.Vector3(0, 0.4, -16), 'Unbuilt territory\nNo missions here');
  const contextBadges = [activeBadge, plannedBadge];
  const blockedStart = nodeMap.get(blockedEdge?.[0])?.point;
  const blockedEnd = nodeMap.get(blockedEdge?.[1])?.point;
  const blockedMidpoint = blockedStart && blockedEnd ? blockedStart.clone().add(blockedEnd).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.3, 0)) : null;
  function updateLabels(): void {
    labelsNeedProjection = true;
    legend.hidden = presentation !== 'work';
    legend.style.display = presentation === 'work' ? 'flex' : 'none';
    missionFootprints.visible = presentation === 'work';
    const target = nodeMap.get(missionContext.target);
    const bounds = stationBounds.get(missionContext.target);
    if (target && bounds) {
      const size = bounds.getSize(new THREE.Vector3());
      missionRing.position.copy(bounds.getCenter(new THREE.Vector3())).setY(0.365);
      missionRing.scale.set(Math.max(0.65, size.x / 2 + 0.12), Math.max(0.65, size.z / 2 + 0.12), 1);
      activeBadge.point.copy(bounds.getCenter(new THREE.Vector3())).setY(target.point.y + 0.4);
      activeBadge.point.z = bounds.min.z - 0.65;
    }
    const availability = missionContext.regions.find((region) => region.active)!.availability;
    missionMaterial.color.set(availability === 'complete' ? '#91c997' : availability === 'locked' ? '#91aaa0' : '#f5c77d');
    missionFootprints.userData = { missionId: missionContext.activeMission, target: missionContext.target, earned: availability === 'complete' };
    activeBadge.element.textContent = `${missionContext.activeLabel}${availability === 'complete' ? ' · Earned' : availability === 'locked' ? ' · Locked' : ''}`;
    activeBadge.element.dataset.mission = missionContext.activeMission;
    activeBadge.element.dataset.availability = availability;
    activeBadge.element.hidden = !target || presentation !== 'work';
    plannedBadge.element.hidden = presentation !== 'work';
    for (const { element, node } of labels) {
      const selected = node.id === selectedId;
      element.hidden = presentation === 'title' || !(mapVisible || selected || (presentation === 'work' && node.id === missionContext.target));
      element.textContent = mapVisible ? node.id : node.label || node.id;
      element.style.fontSize = selected ? '14px' : '12px';
      element.style.borderColor = selected ? '#b58a62' : 'transparent';
      element.style.color = selected ? '#ffe0ae' : '#f0ebda';
      element.style.zIndex = selected ? '2' : '1';
    }
    warningLabel.hidden = !blockedMidpoint || presentation === 'title' || !(mapVisible || selectedId === blockedEdge[0] || selectedId === blockedEdge[1]);
    warningLabel.style.fontSize = '12px';
  }

  const framing = {
    title: { subjectBias: 0, breathingRoom: 1.06 },
    tour: { subjectBias: 0.12, breathingRoom: 1.02 },
    work: { subjectBias: 0.03, breathingRoom: 1.02 },
  } satisfies Record<PresentationMode, { subjectBias: number; breathingRoom: number }>;
  let cameraTransition: { target: THREE.Vector3; halfHeight: number } | null = null;
  let halfHeight = 10;
  let portrait: boolean | null = null;
  const defaultOffset = camera.position.clone().sub(center);
  const fitPoint = new THREE.Vector3();
  const viewBounds = new THREE.Box3();

  function setFrustum(value: number): void {
    halfHeight = value;
    const aspect = width / height;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function frameSettlement(immediate = false): void {
    const selected = selectedId ? nodeMap.get(selectedId) : undefined;
    camera.updateMatrixWorld();
    const inverseRotation = camera.quaternion.clone().invert();
    viewBounds.makeEmpty();
    for (const bounds of [...terrainBounds, ...stationBounds.values()]) {
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            viewBounds.expandByPoint(fitPoint.set(x, y, z).sub(center).applyQuaternion(inverseRotation));
          }
        }
      }
    }
    if (viewBounds.isEmpty()) viewBounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(8, 8, 8));
    const midpoint = viewBounds.getCenter(new THREE.Vector3());
    const mode = framing[presentation];
    if (selected && presentation !== 'title') {
      const subject = selected.point.clone().setY(0.7).sub(center).applyQuaternion(inverseRotation);
      midpoint.lerp(subject, mapVisible ? 0 : mode.subjectBias);
    }
    midpoint.z = 0;
    const target = midpoint.clone().applyQuaternion(camera.quaternion).add(center);
    const horizontal = Math.max(Math.abs(viewBounds.min.x - midpoint.x), Math.abs(viewBounds.max.x - midpoint.x));
    const vertical = Math.max(Math.abs(viewBounds.min.y - midpoint.y), Math.abs(viewBounds.max.y - midpoint.y));
    const usableWidth = Math.max(0.6, 1 - (width < 480 ? 40 : 72) / width);
    const usableHeight = Math.max(0.6, 1 - (height < 500 ? 64 : 100) / height);
    const fitted = Math.max(3.6, vertical / usableHeight, horizontal / (width / height * usableWidth)) * mode.breathingRoom;
    camera.zoom = 1;
    cameraTransition = { target, halfHeight: fitted };
    container.dataset.cameraMoving = 'true';
    if (immediate || reducedMotion) {
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      setFrustum(fitted);
      controls.update();
      cameraTransition = null;
      container.dataset.cameraMoving = 'false';
    }
  }

  function cancelCameraTransition(): void {
    cameraTransition = null;
    container.dataset.cameraMoving = 'false';
  }
  controls.addEventListener('start', cancelCameraTransition);
  const lastOrbitRotation = camera.quaternion.clone();
  let fittingOrbit = false;
  function fitOrbit(): void {
    if (disposed || fittingOrbit || cameraTransition || lastOrbitRotation.angleTo(camera.quaternion) < 0.000001) return;
    lastOrbitRotation.copy(camera.quaternion);
    fittingOrbit = true;
    const zoom = camera.zoom;
    frameSettlement(true);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    fittingOrbit = false;
  }
  controls.addEventListener('change', fitOrbit);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown: [number, number] | null = null;
  function intersect(event: PointerEvent): string | undefined {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const id: unknown = raycaster.intersectObjects(pickables)[0]?.object.userData.nodeId;
    return typeof id === 'string' ? id : undefined;
  }
  function onPointerDown(event: PointerEvent): void { pointerDown = [event.clientX, event.clientY]; }
  function onPointerUp(event: PointerEvent): void {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 6) return;
    const id = intersect(event);
    pointerDown = null;
    if (id) { focusNode(id); onSelect?.(id); }
  }
  function onPointerMove(event: PointerEvent): void { renderer.domElement.style.cursor = intersect(event) ? 'pointer' : 'grab'; }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  function resize() {
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    drawable = nextWidth > 0 && nextHeight > 0;
    if (!drawable) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setSize(width, height, false);
    const nextPortrait = width / height < 1.15;
    if (portrait !== nextPortrait) {
      portrait = nextPortrait;
      defaultOffset.set(portrait ? -9 : 9, 25, 27);
      camera.position.copy(controls.target).add(defaultOffset);
      camera.lookAt(controls.target);
      controls.update();
    }
    updateLabels();
    frameSettlement(true);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let activeRoute: RouteState | null = null;
  let routeTrace = ['dock'];
  container.dataset.routeTrace = JSON.stringify(routeTrace);
  let paused = false;
  let elapsed = 0;
  let previousTime = performance.now();
  let frame: number;

  function setRestored(value: boolean): void {
    if (disposed) return;
    shadowsDirty = true;
    restored = Boolean(value);
    container.dataset.restored = String(restored);
    if (reducedMotion) restoreAmount = restored ? 1 : 0;
  }
  function setSuppliesRestored(value: boolean): void {
    if (disposed) return;
    shadowsDirty = true;
    const suppliesRestored = Boolean(value);
    container.dataset.suppliesRestored = String(suppliesRestored);
    m.supplyWindow.emissiveIntensity = suppliesRestored ? 0.9 : 0;
    if (supplyPallet) supplyPallet.visible = suppliesRestored;
    if (supplyLamp) supplyLamp.visible = suppliesRestored;
  }
  function focusNode(id: string): void {
    if (disposed || !nodeMap.has(id)) return;
    selectedId = id;
    updateSelection();
    frameSettlement();
  }
  function updateSelection(): void {
    shadowsDirty = true;
    for (const [nodeId, object] of selectionRings) object.visible = presentation !== 'title' && nodeId === selectedId;
    const selected = selectedId ? nodeMap.get(selectedId) : undefined;
    subjectLight.intensity = selected && presentation !== 'title' ? presentation === 'tour' ? 2 : 0.8 : 0;
    if (selected) subjectLight.position.copy(selected.point).setY(3);
    updateLabels();
  }
  function showOverview(): void {
    if (disposed) return;
    selectedId = null;
    cameraTransition = null;
    controls.reset();
    controls.target.copy(center);
    camera.position.copy(center).add(defaultOffset);
    camera.lookAt(center);
    controls.update();
    updateSelection();
    frameSettlement();
  }
  function setPresentation(mode: PresentationMode): void {
    if (disposed || presentation === mode) return;
    presentation = mode;
    container.dataset.presentation = mode;
    updateSelection();
    frameSettlement();
  }
  function setMapVisible(value: boolean): void {
    if (disposed) return;
    mapVisible = Boolean(value);
    container.dataset.mapVisible = String(mapVisible);
    updateLabels();
    frameSettlement();
  }
  function reset(): void {
    if (disposed) return;
    clearProgram();
    activeRoute = null;
    clearIntake();
    routeTrace = ['dock'];
    container.dataset.routeTrace = JSON.stringify(routeTrace);
    dronePosition.copy(dockPoint).setY(1.05);
    drone.position.copy(dronePosition);
    drone.rotation.set(0, 0, 0);
    droneYaw = 0;
    trailCount = 0;
    trailGeometry.setDrawRange(0, 0);
    lastTrailPoint.set(Infinity, Infinity, Infinity);
    setRestored(false);
    setSuppliesRestored(false);
  }
  function playRoute(route: readonly (string | Pick<WorldNode, 'id'>)[], { success = true, onComplete }: RouteOptions = {}): void {
    if (disposed) return;
    clearProgram();
    shadowsDirty = true;
    previousTime = performance.now();
    clearIntake();
    activeRoute = null;
    trailCount = 0;
    trailGeometry.setDrawRange(0, 0);
    lastTrailPoint.set(Infinity, Infinity, Infinity);
    const ids: string[] = Array.isArray(route) ? route.map((node: string | Pick<WorldNode, 'id'>) => typeof node === 'string' ? node : node?.id) : [];
    const points: THREE.Vector3[] = [];
    let valid = ids.length > 0;
    for (let i = 0; i < ids.length; i++) {
      const node = nodeMap.get(ids[i]);
      if (!node || (i > 0 && !safeEdges.has(edgeKey(ids[i - 1], ids[i])))) {
        valid = false;
        break;
      }
      points.push(node.point.clone().setY(1.05));
    }
    if (points.length) dronePosition.copy(points[0]);
    routeTrace = ids.length > 0 && nodeMap.has(ids[0]) ? [ids[0]] : [];
    container.dataset.routeTrace = JSON.stringify(routeTrace);
    activeRoute = { ids, points, segment: 0, progress: 0, success: success && valid, onComplete };
    addTrail(dronePosition);
  }
  function updateRoute(delta: number): void {
    if (!activeRoute) return;
    const route = activeRoute;
    while (activeRoute === route) {
      if (route.points.length < 2 || route.segment >= route.points.length - 1) {
        activeRoute = null;
        if (route.success) setRestored(true);
        route.onComplete?.();
        return;
      }
      const a = route.points[route.segment];
      const b = route.points[route.segment + 1];
      const duration = reducedMotion ? 0.09 : Math.max(0.7, a.distanceTo(b) / 2.45);
      const step = Math.min(delta, (1 - route.progress) * duration);
      delta -= step;
      route.progress = Math.min(1, route.progress + step / duration);
      if (route.progress > 1 - 1e-9) route.progress = 1;
      const t = route.progress * route.progress * (3 - 2 * route.progress);
      dronePosition.lerpVectors(a, b, t);
      droneYaw = Math.atan2(b.x - a.x, b.z - a.z);
      addTrail(dronePosition);
      if (route.progress >= 1) {
        route.segment++;
        route.progress = 0;
        routeTrace.push(route.ids[route.segment]);
        container.dataset.routeTrace = JSON.stringify(routeTrace);
      }
      if (delta <= 0 && route.segment < route.points.length - 1) return;
    }
  }
  const projected = new THREE.Vector3();
  const labelView = new THREE.Matrix4();
  const previousLabelView = new THREE.Matrix4();
  const offshoreBounds = new THREE.Box3().setFromObject(future);
  const offshoreView = new THREE.Box2();
  const playableView = new THREE.Box2();
  const playableBounds = [...terrainBounds, ...stationBounds.values()];
  function projectBounds(bounds: THREE.Box3, view: THREE.Box2): void {
    view.makeEmpty();
    for (let corner = 0; corner < 8; corner++) {
      projected.set(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z).project(camera);
      view.min.x = Math.min(view.min.x, projected.x);
      view.min.y = Math.min(view.min.y, projected.y);
      view.max.x = Math.max(view.max.x, projected.x);
      view.max.y = Math.max(view.max.y, projected.y);
    }
  }
  function updateOffshoreVisibility(): void {
    projectBounds(offshoreBounds, offshoreView);
    future.visible = true;
    for (const bounds of playableBounds) {
      projectBounds(bounds, playableView);
      if (offshoreView.intersectsBox(playableView)) { future.visible = false; break; }
    }
  }
  function projectLabel(element: HTMLElement, point: THREE.Vector3): void {
    projected.copy(point).project(camera);
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    element.style.transform = `translate(${x}px,${y}px) translate(-50%,0)`;
    element.style.visibility = projected.z > 1 || projected.z < -1 ? 'hidden' : 'visible';
  }
  function separateWarningLabel(): void {
    if (warningLabel.hidden) return;
    const occupied = labels.filter(({ element }) => !element.hidden).map(({ element }) => element.getBoundingClientRect());
    const bounds = warningLabel.getBoundingClientRect();
    let top = bounds.top;
    for (let i = 0; i < labels.length; i++) {
      const overlap = occupied.find((rect) => bounds.left < rect.right + 5 && bounds.right > rect.left - 5 && top < rect.bottom + 5 && top + bounds.height > rect.top - 5);
      if (!overlap) break;
      top = overlap.top - bounds.height - 6;
    }
    if (top !== bounds.top) warningLabel.style.transform += ` translateY(${top - bounds.top}px)`;
  }
  function separateContextLabels(): void {
    const pane = container.getBoundingClientRect();
    const occupied = labels.filter(({ element }) => !element.hidden).map(({ element }) => element.getBoundingClientRect());
    if (!warningLabel.hidden) occupied.push(warningLabel.getBoundingClientRect());
    for (const { element } of contextBadges) {
      if (element.hidden || element.style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      const dx = Math.max(pane.left + 8 - rect.left, Math.min(0, pane.right - 8 - rect.right));
      let top = rect.top;
      for (let i = 0; i <= occupied.length; i++) {
        const overlap = occupied.find((other) => rect.left + dx < other.right + 5 && rect.right + dx > other.left - 5 && top < other.bottom + 5 && top + rect.height > other.top - 5);
        if (!overlap) break;
        top = overlap.top - rect.height - 6;
      }
      top = Math.max(pane.top + 8, Math.min(pane.bottom - 64 - rect.height, top));
      element.style.transform += ` translate(${dx}px,${top - rect.top}px)`;
      occupied.push(element.getBoundingClientRect());
    }
  }
  function animate(time: number): void {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const playbackDelta = Math.max(0, (time - previousTime) / 1000);
    const delta = Math.min(playbackDelta, 0.05);
    previousTime = time;
    if (document.hidden) return;
    const pane = container.getBoundingClientRect();
    const visible = drawable && pane.bottom > 0 && pane.top < innerHeight && pane.right > 0 && pane.left < innerWidth && container.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const playbackPaused = paused || Boolean(activeProgram?.paused);
    const movingShadows = !playbackPaused && (Boolean(activeRoute || activeIntake) || !reducedMotion || Math.abs(restoreAmount - (restored ? 1 : 0)) > 0.00001);
    shadowsDirty ||= movingShadows;
    if (!playbackPaused && visible) {
      elapsed += delta;
      const intakeBefore = activeIntake;
      updateRoute(playbackDelta);
      if (activeIntake === intakeBefore) updateIntake(playbackDelta);
      updateProgram(delta);
      restoreAmount = THREE.MathUtils.damp(restoreAmount, restored ? 1 : 0, 2.8, delta);
      drone.position.copy(dronePosition);
      if (!reducedMotion) drone.position.y += Math.sin(elapsed * 3) * 0.045;
      drone.rotation.y = THREE.MathUtils.damp(drone.rotation.y, droneYaw, 8, delta);
      droneHalo.scale.setScalar(0.95 + (reducedMotion ? 0 : Math.sin(elapsed * 2) * 0.05));
      if (!reducedMotion) waterMaterial.uniforms.time.value = elapsed;
      foamMaterial.opacity = reducedMotion ? 0.48 : 0.43 + Math.sin(elapsed * 0.8) * 0.08;
    }
    m.greenhouseWindow.emissiveIntensity = restoreAmount * 0.9;
    m.glass.color.set(restored ? '#bad0ae' : '#7faaa1');
    m.glass.opacity = 0.32 + restoreAmount * 0.04;
    m.glass.emissive.set(PALETTE.orange);
    m.glass.emissiveIntensity = restoreAmount * 0.1;
    if (greenhouseLight) greenhouseLight.intensity = restoreAmount * 4;
    if (greenhouseGlow) greenhouseGlow.visible = restoreAmount > 0.05;
    if (greenhouseShutters) {
      greenhouseShutters.children.forEach((shutter, i) => { shutter.position.x = (i ? 1 : -1) * (0.21 + restoreAmount * 0.31); });
    }
    for (const group of plantGroups) group.scale.y = 0.35 + restoreAmount * 0.65;
    if (cameraTransition) {
      const blend = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
      const nextTarget = controls.target.clone().lerp(cameraTransition.target, blend);
      camera.position.add(nextTarget.clone().sub(controls.target));
      controls.target.copy(nextTarget);
      setFrustum(THREE.MathUtils.lerp(halfHeight, cameraTransition.halfHeight, blend));
      if (controls.target.distanceToSquared(cameraTransition.target) < 0.00001 && Math.abs(halfHeight - cameraTransition.halfHeight) < 0.001) {
        cameraTransition = null;
        container.dataset.cameraMoving = 'false';
      }
    }
    controls.update();
    if (!visible) return;
    camera.updateMatrixWorld();
    labelView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (labelsNeedProjection || !labelView.equals(previousLabelView)) {
      updateOffshoreVisibility();
      for (const label of labels) if (!label.element.hidden) projectLabel(label.element, label.point);
      for (const badge of contextBadges) if (!badge.element.hidden) {
        projectLabel(badge.element, badge.point);
        if (badge === activeBadge && programDisplay.visible) badge.element.style.transform += ' translateY(-36px)';
      }
      if (!plannedBadge.element.hidden) plannedBadge.element.style.transform += ' translateY(-44px)';
      projected.copy(plannedBadge.point).project(camera);
      if (!future.visible || Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.95) plannedBadge.element.style.visibility = 'hidden';
      if (blockedMidpoint && !warningLabel.hidden) projectLabel(warningLabel, blockedMidpoint);
      separateWarningLabel();
      separateContextLabels();
      previousLabelView.copy(labelView);
      labelsNeedProjection = false;
    }
    renderer.shadowMap.needsUpdate = shadowsDirty;
    shadowsDirty = false;
    renderer.render(scene, camera);
    finishRenderedProgram();
  }
  frame = requestAnimationFrame(animate);
  const resetClock = () => { previousTime = performance.now(); };
  document.addEventListener('visibilitychange', resetClock);

  return {
    programReader, playProgram,
    setMissionContext(context) {
      if (disposed) return;
      const next = worldMissionView(context);
      if (next === missionContext) return;
      missionContext = next;
      writeMissionContext();
      updateLabels();
    },
    playRoute, playDeliveries, reset, setRestored, setSuppliesRestored, focusNode, setPresentation, showOverview, setMapVisible,
    setTheme(theme) {
      if (disposed) return;
      const day = theme === 'day';
      const waterColor = day ? PALETTE.water : '#4c7473';
      renderer.setClearColor(waterColor, 1);
      waterMaterial.uniforms.dusk.value = day ? 0 : 1;
      ambient.color.set(day ? '#e6eee1' : '#b3c4d0');
      ambient.intensity = day ? 2.5 : 1.5;
      sun.color.set(day ? '#ffe7c3' : '#e5b198');
      sun.intensity = day ? 3.2 : 1.6;
      rimLight.intensity = day ? 0.8 : 0.6;
      fieldLamps.forEach((lamp) => { lamp.intensity = day ? 0.25 : 1.6; });
      renderer.toneMappingExposure = day ? 1.12 : 1.04;
    },
    setPaused(value) { if (disposed) return; paused = Boolean(value); resetClock(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearProgram();
      programEvents.abort();
      activeRoute = null;
      activeIntake = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resetClock);
      controls.removeEventListener('start', cancelCameraTransition);
      controls.removeEventListener('change', fitOrbit);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((mat) => mat.dispose());
      instances.forEach((instance) => instance.dispose());
      sun.shadow.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelsLayer.remove();
      programCaption.remove();
      programReader.remove();
      clearMissionContext();
    },
  };
}
