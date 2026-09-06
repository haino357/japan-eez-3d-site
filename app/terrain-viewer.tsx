'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Rotate3D, Waves } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type ViewName = 'oblique' | 'top' | 'east';
type Ring = number[][];
type EEZFeature = { properties: { name: string; kind: string }; geometry: { coordinates: Ring[][] } };
type TerrainData = { w: number; h: number; extent: [number, number, number, number]; heights: string; mask: string; eez: EEZFeature[]; coasts: Ring[] };

const VIEW_POSITIONS: Record<ViewName, [number, number, number]> = {
  oblique: [1100, 3900, 4000], top: [0, 5800, 1], east: [4600, 2700, 0],
};
const LABELS: Array<[string, number, number]> = [
  ['北海道', 143, 43.5], ['本州', 137.5, 37], ['九州', 130.8, 32.5], ['沖縄', 127.7, 26.2],
  ['小笠原諸島', 142.2, 27.1], ['沖ノ鳥島', 136.08, 20.42], ['南鳥島', 153.98, 24.28],
  ['日本海溝', 144.3, 38.2], ['伊豆・小笠原海溝', 143.7, 30], ['日本海', 134, 40.5],
];

function decodeBase64(value: string) {
  const raw = atob(value);
  const result = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) result[index] = raw.charCodeAt(index);
  return result;
}

function project([longitude, latitude]: [number, number]): [number, number] {
  const lambda = longitude * Math.PI / 180;
  const phi = latitude * Math.PI / 180;
  const lambda0 = 139 * Math.PI / 180;
  const phi0 = 32 * Math.PI / 180;
  const denominator = 1 + Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0);
  const k = Math.sqrt(2 / denominator) * 6371;
  return [k * Math.cos(phi) * Math.sin(lambda - lambda0), -k * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0))];
}

function inverseProject([x, z]: [number, number]): [number, number] {
  const lambda0 = 139 * Math.PI / 180;
  const phi0 = 32 * Math.PI / 180;
  const rho = Math.sqrt(x * x + z * z);
  if (!rho) return [139, 32];
  const c = 2 * Math.asin(Math.min(1, rho / (2 * 6371)));
  const phi = Math.asin(Math.cos(c) * Math.sin(phi0) - (z * Math.sin(c) * Math.cos(phi0)) / rho);
  const lambda = lambda0 + Math.atan2(x * Math.sin(c), rho * Math.cos(phi0) * Math.cos(c) + z * Math.sin(phi0) * Math.sin(c));
  return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
}

export default function TerrainViewer() {
  const stageRef = useRef<HTMLDivElement>(null);
  const exaggerationRef = useRef(35);
  const waterRef = useRef(true);
  const viewRef = useRef<ViewName>('oblique');
  const apiRef = useRef<{ redraw: () => void; setView: (view: ViewName) => void; setWater: (visible: boolean) => void } | null>(null);
  const [exaggeration, setExaggeration] = useState(35);
  const [waterVisible, setWaterVisible] = useState(true);
  const [view, setView] = useState<ViewName>('oblique');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reading, setReading] = useState('地形を選ぶと、その地点の標高または水深を表示します');

  useEffect(() => { exaggerationRef.current = exaggeration; apiRef.current?.redraw(); }, [exaggeration]);
  useEffect(() => { waterRef.current = waterVisible; apiRef.current?.setWater(waterVisible); }, [waterVisible]);
  useEffect(() => { viewRef.current = view; apiRef.current?.setView(view); }, [view]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let detach: (() => void) | undefined;
    const labelElements: HTMLSpanElement[] = [];

    async function build() {
      try {
        const response = await fetch(
          new URL('japan-data.json', document.baseURI),
        );
        if (!response.ok) throw new Error('地形データを読み込めませんでした');
        const data = await response.json() as TerrainData;
        if (cancelled || !stage) return;
        const { w: width, h: height } = data;
        const elevations = new Int16Array(decodeBase64(data.heights).buffer);
        const mask = decodeBase64(data.mask);
        const inside = (index: number) => (mask[index >> 3] >> (7 - (index & 7))) & 1;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(43, 1, 5, 30000);
        camera.position.set(...VIEW_POSITIONS[viewRef.current]);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        stage.prepend(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.minDistance = 500;
        controls.maxDistance = 15000;
        controls.maxPolarAngle = Math.PI * 0.48;
        controls.target.set(0, -70, 0);
        scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x071821, 2.8));
        const light = new THREE.DirectionalLight(0xffffff, 2.5);
        light.position.set(-2500, 6000, 2000);
        scene.add(light);

        const world = new THREE.Group();
        scene.add(world);
        const positions = new Float32Array(width * height * 3);
        const colors = new Float32Array(width * height * 3);
        const deep = new THREE.Color('#083d77');
        const shallow = new THREE.Color('#41b9c1');
        const land = new THREE.Color('#78b879');
        const high = new THREE.Color('#d5d0ba');
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const index = row * width + column;
            const point = project([120 + (column + 0.5) * 38 / width, 48 - (row + 0.5) * 31 / height]);
            positions[index * 3] = point[0];
            positions[index * 3 + 1] = elevations[index] / 1000;
            positions[index * 3 + 2] = point[1];
            const color = elevations[index] >= 0 ? land.clone().lerp(high, Math.min(elevations[index] / 3600, 1)) : shallow.clone().lerp(deep, Math.min(1, -elevations[index] / 9500));
            if (!inside(index)) color.lerp(new THREE.Color('#edf4f5'), 0.72);
            color.toArray(colors, index * 3);
          }
        }

        const indices: number[] = [];
        const waterIndices: number[] = [];
        for (let row = 0; row < height - 1; row += 1) {
          for (let column = 0; column < width - 1; column += 1) {
            const a = row * width + column, b = a + 1, d = a + width, e = d + 1;
            indices.push(a, d, b, b, d, e);
            if (inside(a) && inside(b) && inside(d) && elevations[a] < 0 && elevations[b] < 0 && elevations[d] < 0) waterIndices.push(a, d, b);
            if (inside(b) && inside(d) && inside(e) && elevations[b] < 0 && elevations[d] < 0 && elevations[e] < 0) waterIndices.push(b, d, e);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
        world.add(terrain);

        const waterGroup = new THREE.Group();
        world.add(waterGroup);
        const waterPositions = positions.slice();
        for (let index = 0; index < width * height; index += 1) waterPositions[index * 3 + 1] = 0.04;
        const waterGeometry = new THREE.BufferGeometry();
        waterGeometry.setAttribute('position', new THREE.BufferAttribute(waterPositions, 3));
        waterGeometry.setIndex(waterIndices);
        waterGeometry.computeVertexNormals();
        waterGroup.add(new THREE.Mesh(waterGeometry, new THREE.MeshPhysicalMaterial({ color: '#66d5dd', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, roughness: 0.35, metalness: 0.05 })));

        const heightAt = (longitude: number, latitude: number) => {
          const column = Math.min(width - 1, Math.max(0, Math.round((longitude - 120) * width / 38 - 0.5)));
          const row = Math.min(height - 1, Math.max(0, Math.round((48 - latitude) * height / 31 - 0.5)));
          return elevations[row * width + column] / 1000;
        };
        const makeLine = (points: Ring, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial, elevation = 0.09) => {
          const values: number[] = [];
          points.forEach(([longitude, latitude]) => { const point = project([longitude, latitude]); values.push(point[0], elevation, point[1]); });
          const lineGeometry = new THREE.BufferGeometry();
          lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
          return new THREE.Line(lineGeometry, material);
        };
        const boundaryMaterial = new THREE.LineBasicMaterial({ color: '#ff975e' });
        const jointMaterial = new THREE.LineDashedMaterial({ color: '#bfa2ff', dashSize: 22, gapSize: 14 });
        const coastMaterial = new THREE.LineBasicMaterial({ color: '#d8f6f0', transparent: true, opacity: 0.72 });
        const wallPositions: number[] = [];
        data.eez.forEach((feature, featureIndex) => {
          feature.geometry.coordinates.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
            const boundary = makeLine(ring, featureIndex ? jointMaterial : boundaryMaterial);
            if (featureIndex) boundary.computeLineDistances();
            world.add(boundary);
            if (featureIndex === 0 && ringIndex === 0) {
              for (let index = 0; index < ring.length - 1; index += 1) {
                const first = ring[index] as [number, number], second = ring[index + 1] as [number, number];
                const p = project(first), q = project(second);
                const hp = Math.min(0, heightAt(...first)), hq = Math.min(0, heightAt(...second));
                wallPositions.push(p[0], 0, p[1], p[0], hp, p[1], q[0], 0, q[1], q[0], 0, q[1], p[0], hp, p[1], q[0], hq, q[1]);
              }
            }
          }));
        });
        const wallGeometry = new THREE.BufferGeometry();
        wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
        waterGroup.add(new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({ color: '#ff975e', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })));
        data.coasts.forEach((coast) => world.add(makeLine(coast, coastMaterial, 0.065)));

        const labelLayer = document.createElement('div');
        labelLayer.className = 'map-labels';
        stage.append(labelLayer);
        const labels = LABELS.map(([name, longitude, latitude]) => {
          const element = document.createElement('span');
          element.className = 'map-label';
          element.textContent = name;
          labelLayer.append(element);
          labelElements.push(element);
          return { element, longitude, latitude };
        });
        const redraw = () => {
          if (!renderer) return;
          world.scale.y = exaggerationRef.current;
          renderer.render(scene, camera);
          const stageWidth = stage.clientWidth, stageHeight = stage.clientHeight;
          const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
          labels.forEach(({ element, longitude, latitude }) => {
            const point = project([longitude, latitude]);
            const vector = new THREE.Vector3(point[0], Math.max(0, heightAt(longitude, latitude)) * exaggerationRef.current + 65, point[1]).project(camera);
            const x = (vector.x + 1) * stageWidth / 2, y = (1 - vector.y) * stageHeight / 2;
            element.style.left = `${x}px`; element.style.top = `${y}px`; element.hidden = false;
            const box = { left: x - element.offsetWidth / 2, right: x + element.offsetWidth / 2, top: y - element.offsetHeight / 2, bottom: y + element.offsetHeight / 2 };
            const hidden = vector.z > 1 || box.left < 0 || box.right > stageWidth || box.top < 0 || box.bottom > stageHeight || occupied.some((item) => item.left < box.right + 4 && item.right > box.left - 4 && item.top < box.bottom + 4 && item.bottom > box.top - 4);
            element.hidden = hidden;
            if (!hidden) occupied.push(box);
          });
        };
        const resize = () => {
          if (!renderer) return;
          const stageWidth = stage.clientWidth, stageHeight = stage.clientHeight;
          renderer.setSize(stageWidth, stageHeight, false);
          camera.aspect = stageWidth / stageHeight;
          camera.zoom = Math.min(1, stageWidth / 560);
          camera.updateProjectionMatrix();
          redraw();
        };
        controls.addEventListener('change', redraw);
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(stage);
        let pointerDown: [number, number] | undefined;
        const raycaster = new THREE.Raycaster();
        const onPointerDown = (event: PointerEvent) => { pointerDown = [event.clientX, event.clientY]; };
        const onPointerUp = (event: PointerEvent) => {
          if (!renderer || !pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 6) return;
          const bounds = renderer.domElement.getBoundingClientRect();
          raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), camera);
          const hit = raycaster.intersectObject(terrain)[0];
          if (!hit) return;
          const [longitude, latitude] = inverseProject([hit.point.x, hit.point.z]);
          const meters = hit.point.y / exaggerationRef.current * 1000;
          setReading(`北緯 ${latitude.toFixed(2)}°／東経 ${longitude.toFixed(2)}°　${meters < 0 ? '水深' : '標高'} 約${Math.round(Math.abs(meters) / 10) * 10} m`);
        };
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointerup', onPointerUp);
        let frame = 0;
        const animate = () => { if (cancelled) return; frame = requestAnimationFrame(animate); controls?.update(); redraw(); };
        apiRef.current = {
          redraw,
          setView: (nextView) => { camera.position.set(...VIEW_POSITIONS[nextView]); controls?.target.set(0, -70, 0); controls?.update(); redraw(); },
          setWater: (visible) => { waterGroup.visible = visible; redraw(); },
        };
        waterGroup.visible = waterRef.current;
        resize(); animate(); setLoading(false);
        detach = () => { cancelAnimationFrame(frame); renderer?.domElement.removeEventListener('pointerdown', onPointerDown); renderer?.domElement.removeEventListener('pointerup', onPointerUp); };
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '3D表示を開始できませんでした');
        setLoading(false);
      }
    }
    void build();
    return () => {
      cancelled = true; detach?.(); resizeObserver?.disconnect(); controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
      labelElements.forEach((element) => element.remove()); apiRef.current = null;
    };
  }, []);

  return (
    <main className="site-shell">
      <header className="site-header">
        <div><p className="eyebrow"><Waves aria-hidden="true" /> JAPAN OCEAN FLOOR</p><h1>日本列島とEEZ・海底地形</h1></div>
        <p className="header-note">北緯17–48°／東経120–158°</p>
      </header>
      <section className="viewer-shell" aria-label="3D地形ビューア">
        <div className="viewer-toolbar">
          <div className="control control-wide">
            <div className="control-label"><span>高さ・深さの強調</span><output>{exaggeration}倍</output></div>
            <Slider min={1} max={100} step={1} value={[exaggeration]} onValueChange={(value) => setExaggeration(Array.isArray(value) ? value[0] : Number(value))} aria-label="高さと深さの強調倍率" />
          </div>
          <div className="control">
            <label className="control-label" htmlFor="view-select">視点</label>
            <Select value={view} onValueChange={(value) => setView(value as ViewName)}>
              <SelectTrigger id="view-select" className="view-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="oblique">南から斜めに</SelectItem><SelectItem value="top">真上から</SelectItem><SelectItem value="east">太平洋側から</SelectItem></SelectContent>
            </Select>
          </div>
          <label className="switch-control"><Switch checked={waterVisible} onCheckedChange={setWaterVisible} aria-label="EEZの海面と側面を表示" /><span>EEZの海面・側面</span></label>
        </div>
        <div ref={stageRef} className="terrain-stage" role="img" aria-label="日本列島、排他的経済水域、海底地形の3Dモデル。ドラッグで回転、ホイールまたはピンチで拡大できます。">
          {loading && <div className="loading-state">海底地形を読み込んでいます…</div>}
          {error && <div className="error-state" role="alert">{error}</div>}
        </div>
        <div className="viewer-footer"><p className="reading" aria-live="polite">{reading}</p><p className="gesture"><Rotate3D aria-hidden="true" /> ドラッグで回転・スクロール／ピンチで拡大</p></div>
      </section>
      <footer className="site-footer">
        <div className="legend" aria-label="凡例">
          <span><i className="legend-land" />陸地</span><span><i className="legend-shallow" />浅海</span><span><i className="legend-deep" />深海（〜9,700m）</span><span><i className="legend-eez" />EEZ外縁・海岸</span><span><i className="legend-joint" />日韓共同開発区域</span>
        </div>
        <p className="source-note">地形：<a href="https://www.ncei.noaa.gov/products/etopo-global-relief-model" target="_blank" rel="noreferrer">NOAA ETOPO1</a>（約8〜9km格子）　境界：<a href="https://marineregions.org/" target="_blank" rel="noreferrer">Marine Regions</a>　海岸線：<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></p>
        <p className="disclaimer">EEZは境界未画定海域を含む参考表示です。法的判断や航海には使用できません。</p>
      </footer>
    </main>
  );
}
