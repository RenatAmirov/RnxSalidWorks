import createManifold from 'manifold-3d';
import wasm from 'manifold-3d/manifold.wasm?url&inline';
import { PLANES, shapePoints, sketchFor, validateProject } from './model.js';

export async function initKernel() {
  const module = await createManifold({ locateFile: () => wasm });
  module.setup();
  const { CrossSection, Manifold } = module;

  function build(project) {
    validateProject(project);
    const objects = [];
    const keep = (object) => {
      objects.push(object);
      return object;
    };
    let solid;
    try {
      for (const feature of project.features) {
        if (feature.type === 'sketch' || feature.suppressed) continue;
        const sketch = sketchFor(project, feature);
        if (feature.type !== 'extrude' && !solid) continue;
        const { u, v, normal } = PLANES[sketch.plane];
        const profiles = sketch.shapes.map((shape) => keep(new CrossSection([shapePoints(shape)], 'EvenOdd')));
        const profile = keep(CrossSection.union(profiles));
        if (profile.isEmpty()) throw new Error(`Эскиз «${sketch.name}» не образует область.`);
        const prism = keep(profile.extrude(feature.depth));
        const place = (offset) => keep(prism.transform([
          ...u, 0, ...v, 0, ...normal, 0, ...normal.map((axis) => axis * offset), 1,
        ]));
        const start = sketch.offset - (feature.reverse ? feature.depth : 0);
        let tool = place(start);
        if (feature.spacing) tool = keep(Manifold.union(tool, place(start + feature.spacing)));
        if (feature.type === 'extrude') {
          solid = solid ? keep(Manifold.union(solid, tool)) : tool;
        } else {
          solid = keep(Manifold.difference(solid, tool));
        }
        if (solid.status() !== 'NoError') throw new Error(`Ошибка геометрии в операции «${feature.name}».`);
      }
      if (!solid || solid.isEmpty()) return null;
      const mesh = keep(solid.calculateNormals(0, 24)).getMesh(0);
      const positions = new Float32Array(mesh.numVert * 3);
      const normals = new Float32Array(positions.length);
      for (let index = 0; index < mesh.numVert; index++) {
        const vertex = mesh.vertProperties.subarray(index * mesh.numProp, (index + 1) * mesh.numProp);
        positions.set(vertex.subarray(0, 3), index * 3);
        normals.set(vertex.subarray(3, 6), index * 3);
      }
      return { positions, normals, indices: mesh.triVerts.slice(), bounds: solid.boundingBox(), volume: solid.volume() };
    } finally {
      for (const object of objects.reverse()) object.delete();
    }
  }

  return { build };
}

export function binaryStl(mesh) {
  const count = mesh.indices.length / 3;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set(new TextEncoder().encode('Rnx CAD | millimeters'));
  view.setUint32(80, count, true);
  const point = (index) => [...mesh.positions.subarray(index * 3, index * 3 + 3)];
  for (let face = 0; face < count; face++) {
    const [a, b, c] = [...mesh.indices.subarray(face * 3, face * 3 + 3)].map(point);
    const [ux, uy, uz] = b.map((value, axis) => value - a[axis]);
    const [vx, vy, vz] = c.map((value, axis) => value - a[axis]);
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal) || 1;
    [...normal.map((value) => value / length), ...a, ...b, ...c].forEach((value, index) => {
      view.setFloat32(84 + face * 50 + index * 4, value, true);
    });
  }
  return buffer;
}
