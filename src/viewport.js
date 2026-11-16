import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DIRECTIONS = {
  iso: [1.08, -1.8, 1.22], top: [0, -0.00001, 1], bottom: [0, -0.00001, -1],
  front: [0, -1, 0], right: [1, 0, 0], back: [0, 1, 0], left: [-1, 0, 0],
};

function lines(coordinates, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

function gridAt(center, step, z) {
  const grid = new THREE.Group();
  const minor = [];
  const major = [];
  const extent = step * 60;
  const cx = Math.round(center.x / (step * 5)) * step * 5;
  const cy = Math.round(center.y / (step * 5)) * step * 5;
  for (let index = -60; index <= 60; index++) {
    const coordinates = index % 5 === 0 ? major : minor;
    const x = cx + index * step;
    const y = cy + index * step;
    coordinates.push(x, cy - extent, z, x, cy + extent, z, cx - extent, y, z, cx + extent, y, z);
  }
  grid.add(lines(minor, '#acbedc', 0.46), lines(major, '#9cb4d8', 0.65));
  grid.add(lines([cx - extent, 0, z, cx + extent, 0, z], '#cf8186', 0.46));
  grid.add(lines([0, cy - extent, z, 0, cy + extent, z], '#68a997', 0.65));
  return grid;
}

function dispose(object) {
  object?.parent?.remove(object);
  object?.traverse((child) => {
    child.geometry?.dispose();
    child.material?.dispose();
  });
}

export function createViewport(container, cube, axes, onOrbit) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Трёхмерная модель детали');
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 100000);
  camera.up.set(0, 0, 1);
  camera.position.set(200, -300, 240);
  const controls = new OrbitControls(camera, renderer.domElement);
  let needsRender = true;
  controls.addEventListener('change', () => { needsRender = true; });
  controls.enableDamping = true;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.85;
  controls.minZoom = 0.05;
  controls.maxZoom = 60;
  controls.addEventListener('end', () => { if (userRotating) onOrbit(); userRotating = false; });
  let userRotating = false;
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.buttons === 1 && controls.mouseButtons.LEFT === THREE.MOUSE.ROTATE) userRotating = true;
  });
  renderer.domElement.addEventListener('dblclick', () => fit());

  scene.add(new THREE.HemisphereLight('#f7faff', '#9aafce', 2.03));
  const key = new THREE.DirectionalLight('#fffaf5', 2.15);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.intensity = 0.72;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#93b7ff', 0.6);
  scene.add(fill, fill.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({ opacity: 0.24, color: '#263d68' }));
  floor.receiveShadow = true;
  scene.add(floor);

  let grid;
  let body;
  let edgeLines;
  let display = 'edges';
  let showGrid = true;
  let active = true;
  let halfHeight = 90;
  let orientation = 'iso';
  let bounds = new THREE.Box3(new THREE.Vector3(-45, -35, 0), new THREE.Vector3(45, 35, 0));

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    const aspect = width / height;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    needsRender = true;
  }
  new ResizeObserver(resize).observe(container);

  function fit(view = orientation) {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.length(), 1);
    const direction = view === 'free' ? camera.position.clone().sub(controls.target).normalize() : new THREE.Vector3(...DIRECTIONS[view]).normalize();
    camera.position.copy(center).addScaledVector(direction, span * 2.5);
    controls.target.copy(center);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const projected = new THREE.Box3();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
        }
      }
    }
    const frame = projected.getSize(new THREE.Vector3());
    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
    halfHeight = Math.max(frame.y / 0.76, frame.x / (0.73 * aspect), span * 0.35) / 2;
    camera.zoom = 1;
    controls.update();
    resize();
  }

  function updateDisplay() {
    needsRender = true;
    if (!body) return;
    body.visible = display !== 'wire';
    edgeLines.visible = display !== 'solid';
    body.castShadow = display !== 'wire';
    floor.visible = display !== 'wire' && showGrid;
  }

  function updateModel(mesh, color, reframe = false) {
    dispose(body);
    dispose(edgeLines);
    if (mesh) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, metalness: 0.21, roughness: 0.54 }));
      body.castShadow = true;
      body.receiveShadow = true;
      edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 19),
        new THREE.LineBasicMaterial({ color: '#254786', transparent: true, opacity: 0.68, depthWrite: false }));
      edgeLines.renderOrder = 2;
      scene.add(body, edgeLines);
      bounds = new THREE.Box3(new THREE.Vector3(...mesh.bounds.min), new THREE.Vector3(...mesh.bounds.max));
    } else {
      body = null;
      edgeLines = null;
      bounds = new THREE.Box3(new THREE.Vector3(-45, -35, 0), new THREE.Vector3(45, 35, 0));
    }
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.length(), 10);
    const step = 10 ** Math.floor(Math.log10(span / 9));
    const floorZ = Math.min(0, bounds.min.z) - span * 0.001;
    dispose(grid);
    grid = gridAt(center, step, floorZ);
    grid.visible = showGrid;
    scene.add(grid);
    floor.position.set(center.x, center.y, floorZ - span * 0.0005);
    floor.scale.setScalar(span * 3);
    floor.visible = Boolean(mesh) && showGrid;
    key.position.copy(center).addScaledVector(new THREE.Vector3(-1.4, -1, 2.1), span);
    key.target.position.copy(center);
    fill.position.copy(center).addScaledVector(new THREE.Vector3(1.3, 1, 0.7), span);
    fill.target.position.copy(center);
    Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: span * 0.1, far: span * 6 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = span * 0.0014;
    key.shadow.bias = -0.00003;
    scene.fog = new THREE.Fog('#e9eff8', span * 3.1, span * 6.5);
    updateDisplay();
    if (reframe) fit();
  }

  const inverse = new THREE.Quaternion();
  const cubeBasis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)];
  const vector = new THREE.Vector3();
  let previousQuaternion = '';
  renderer.setAnimationLoop(() => {
    if (!active) return;
    controls.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
    const quaternion = camera.quaternion.toArray().join(',');
    if (quaternion === previousQuaternion) return;
    previousQuaternion = quaternion;
    inverse.copy(camera.quaternion).invert();
    const columns = cubeBasis.flatMap((basis) => {
      vector.copy(basis).applyQuaternion(inverse);
      return [vector.x, -vector.y, vector.z, 0];
    });
    cube.style.transform = `matrix3d(${[...columns, 0, 0, 0, 1].join(',')})`;
    axes.forEach((axis, index) => {
      vector.set(0, 0, 0).setComponent(index, 1).applyQuaternion(inverse);
      const x = vector.x * 28;
      const y = -vector.y * 28;
      axis.style.setProperty('--length', `${Math.hypot(x, y)}px`);
      axis.style.setProperty('--rotation', `${Math.atan2(y, x)}rad`);
      axis.style.setProperty('--x', `${x * 1.3}px`);
      axis.style.setProperty('--y', `${y * 1.3}px`);
    });
  });

  return {
    updateModel,
    fit: () => fit(),
    setView(view) { orientation = view; fit(view); },
    setFree() { orientation = 'free'; },
    setActive(value) { active = value; controls.enabled = value; if (value) resize(); },
    setGrid(value) { showGrid = value; if (grid) grid.visible = value; updateDisplay(); },
    setDisplay(value) { display = value; updateDisplay(); },
    setPan(value) {
      controls.mouseButtons.LEFT = value ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      container.classList.toggle('panning', value);
    },
  };
}
