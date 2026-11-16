import { PLANES, shapePoints } from './model.js';

const PAINT = { fill: 'rgba(54, 109, 226, .13)', stroke: '#346bdd', active: '#2157cd' };

export function createSketchEditor(canvas, events) {
  const ctx = canvas.getContext('2d');
  let draft;
  let projection;
  let tool = 'select';
  let selected = -1;
  let scale = 4;
  let center = [0, 0];
  let width = 0;
  let height = 0;
  let grid = true;
  let snap = true;
  let cursor;
  let points = [];
  let gesture;

  const toScreen = ([x, y]) => [width / 2 + (x - center[0]) * scale, height / 2 - (y - center[1]) * scale];
  const toModel = ([x, y]) => [(x - width / 2) / scale + center[0], (height / 2 - y) / scale + center[1]];
  const pointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const toPoint = (pixel) => toModel(pixel).map((value) => Math.round(value * (snap ? 1 : 100)) / (snap ? 1 : 100));

  function drawGrid() {
    const [left, bottom] = toModel([0, height]);
    const [right, top] = toModel([width, 0]);
    const step = 10 ** Math.ceil(Math.log10(42 / scale));
    const [ox, oy] = toScreen([0, 0]);
    const drawLine = (from, to, color) => {
      ctx.beginPath();
      ctx.moveTo(...from);
      ctx.lineTo(...to);
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    if (grid) {
      for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
        const [px] = toScreen([x, 0]);
        drawLine([px, 0], [px, height], x === 0 ? '#afc6d6' : '#d6e0f0');
      }
      for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
        const [, py] = toScreen([0, y]);
        drawLine([0, py], [width, py], y === 0 ? '#c7b1bd' : '#d6e0f0');
      }
    }
    ctx.fillStyle = '#627792';
    ctx.beginPath();
    ctx.arc(ox, oy, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawProjection() {
    if (!projection) return;
    const { vertices, indices } = projection;
    ctx.save();
    const origin = toScreen([0, 0]);
    ctx.translate(...origin);
    ctx.scale(scale, -scale);
    ctx.beginPath();
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]];
      const signed = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (!signed) continue;
      ctx.moveTo(...a);
      ctx.lineTo(...(signed > 0 ? b : c));
      ctx.lineTo(...(signed > 0 ? c : b));
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(116, 148, 200, .18)';
    ctx.fill();
    ctx.restore();
  }

  function drawShape(shape, active, preview = false) {
    ctx.beginPath();
    if (shape.type === 'circle') {
      ctx.arc(...toScreen([shape.x, shape.y]), shape.radius * scale, 0, Math.PI * 2);
    } else {
      const [first, ...rest] = shapePoints(shape);
      ctx.moveTo(...toScreen(first));
      for (const point of rest) ctx.lineTo(...toScreen(point));
      ctx.closePath();
    }
    ctx.fillStyle = PAINT.fill;
    ctx.fill();
    ctx.strokeStyle = active ? PAINT.active : PAINT.stroke;
    ctx.lineWidth = active ? 2.5 : 1.5;
    if (preview) ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  function shapeFrom(a, b) {
    if (tool === 'rect') {
      return { type: 'rect', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2,
        width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), radius: 0 };
    }
    return { type: 'circle', x: a[0], y: a[1], radius: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  }

  function render() {
    if (!draft || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    drawGrid();
    drawProjection();
    draft.shapes.forEach((shape, index) => drawShape(shape, index === selected));
    if (tool === 'polygon' && points.length) {
      const screen = points.map(toScreen);
      ctx.beginPath();
      ctx.moveTo(...screen[0]);
      screen.slice(1).forEach((point) => ctx.lineTo(...point));
      if (cursor) ctx.lineTo(...toScreen(cursor));
      ctx.strokeStyle = PAINT.stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      screen.forEach(([x, y]) => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.strokeRect(x - 3, y - 3, 6, 6);
      });
    } else if (points.length && cursor) {
      const shape = shapeFrom(points[0], cursor);
      if (shape.radius > 0 || (shape.width > 0 && shape.height > 0)) drawShape(shape, false, true);
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }
  new ResizeObserver(resize).observe(canvas);

  function fit() {
    const vertices = [...(projection?.vertices ?? []), ...draft.shapes.flatMap(shapePoints)];
    if (!vertices.length) vertices.push([-60, -45], [60, 45]);
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    for (const [x, y] of vertices) {
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
      max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
    }
    center = min.map((value, axis) => (value + max[axis]) / 2);
    scale = Math.min(width * 0.7 / Math.max(24, max[0] - min[0]), height * 0.67 / Math.max(24, max[1] - min[1]), 30);
    render();
  }

  function project(mesh) {
    if (!mesh) return null;
    const { u, v } = PLANES[draft.plane];
    const vertices = [];
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const coordinates = mesh.positions.subarray(index, index + 3);
      vertices.push([u, v].map((axis) => axis.reduce((sum, amount, dim) => sum + amount * coordinates[dim], 0)));
    }
    return { vertices, indices: mesh.indices };
  }

  function addShape(shape) {
    points = [];
    events.shape(shape);
  }

  function finishPolygon() {
    if (tool !== 'polygon' || points.length < 3) return false;
    const area = points.reduce((sum, a, index) => {
      const b = points[(index + 1) % points.length];
      return sum + a[0] * b[1] - a[1] * b[0];
    }, 0);
    if (Math.abs(area) < 0.0001) return false;
    addShape({ type: 'polygon', points });
    return true;
  }

  function contains(shape, point) {
    if (shape.type === 'circle') return Math.hypot(point[0] - shape.x, point[1] - shape.y) <= shape.radius;
    const vertices = shapePoints(shape);
    return vertices.reduce((inside, [x, y], index) => {
      const [nx, ny] = vertices[(index + 1) % vertices.length];
      const crosses = (y > point[1]) !== (ny > point[1]) && point[0] < (nx - x) * (point[1] - y) / (ny - y) + x;
      return inside !== crosses;
    }, false);
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (!draft) return;
    const pixel = pointer(event);
    gesture = { pixel, point: toPoint(pixel), center: [...center], pan: event.button !== 0 || tool === 'pan' || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { gesture = null; render(); });
  canvas.addEventListener('pointermove', (event) => {
    if (!draft) return;
    const pixel = pointer(event);
    if (gesture?.pan) {
      center = [gesture.center[0] - (pixel[0] - gesture.pixel[0]) / scale, gesture.center[1] + (pixel[1] - gesture.pixel[1]) / scale];
    } else if (gesture && ['rect', 'circle'].includes(tool) && !points.length && Math.hypot(pixel[0] - gesture.pixel[0], pixel[1] - gesture.pixel[1]) > 5) {
      points = [gesture.point];
    }
    cursor = toPoint(pixel);
    events.cursor(cursor);
    render();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!gesture) return;
    const { pan } = gesture;
    gesture = null;
    if (pan) return;
    const pixel = pointer(event);
    const point = toPoint(pixel);
    if (tool === 'select') {
      events.select(draft.shapes.findLastIndex((shape) => contains(shape, toModel(pixel))));
    } else if (tool === 'polygon') {
      const first = points[0];
      const previous = points.at(-1);
      if (points.length > 2 && Math.hypot((point[0] - first[0]) * scale, (point[1] - first[1]) * scale) < 12) finishPolygon();
      else if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
    } else if (!points.length) {
      points = [point];
    } else {
      const shape = shapeFrom(points[0], point);
      if (shape.radius >= 0.01 || (shape.width >= 0.01 && shape.height >= 0.01)) addShape(shape);
    }
    cursor = point;
    render();
  });
  canvas.addEventListener('dblclick', () => { if (tool === 'select') fit(); else finishPolygon(); });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pixel = pointer(event);
    const previous = toModel(pixel);
    scale = Math.min(1000, Math.max(0.0001, scale * Math.exp(-event.deltaY * 0.0015)));
    const current = toModel(pixel);
    center = center.map((value, axis) => value + previous[axis] - current[axis]);
    render();
  }, { passive: false });

  return {
    start(value, mesh) { draft = value; selected = -1; projection = project(mesh); points = []; resize(); fit(); },
    update(value, index) { draft = value; selected = index; render(); },
    reproject(mesh) { projection = project(mesh); fit(); },
    setTool(value) { tool = value; points = []; canvas.dataset.tool = value; render(); },
    cancelGesture() { if (!points.length) return false; points = []; render(); return true; },
    finishPolygon,
    fit,
    setGrid(value) { grid = value; render(); },
    setSnap(value) { snap = value; },
  };
}
