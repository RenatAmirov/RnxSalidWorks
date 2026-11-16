export const PLANES = {
  XY: { label: 'Сверху (XY)', normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], view: 'top' },
  XZ: { label: 'Спереди (XZ)', normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], view: 'front' },
  YZ: { label: 'Справа (YZ)', normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], view: 'right' },
};

export const MATERIALS = {
  aluminium: { label: 'Алюминий 6061', density: 2.7, color: '#789bef' },
  steel: { label: 'Сталь', density: 7.85, color: '#9baec8' },
  plastic: { label: 'АБС-пластик', density: 1.05, color: '#7ebda8' },
};

export const FEATURES = {
  sketch: { label: 'Эскиз', icon: 'pencil-ruler' },
  extrude: { label: 'Вытягивание', icon: 'box' },
  cut: { label: 'Вырез', icon: 'square-minus' },
  hole: { label: 'Отверстие', icon: 'circle-dot' },
};

export const SHAPES = {
  rect: { label: 'Прямоугольник', icon: 'square' },
  circle: { label: 'Окружность', icon: 'circle' },
  polygon: { label: 'Многоугольник', icon: 'pentagon' },
};

export function newProject(name = 'Новая деталь') {
  return { format: 'rnx-cad', version: 1, name, material: 'aluminium', features: [] };
}

export function demoProject() {
  const project = newProject('Опорный кронштейн');
  project.features = [
    { id: 's1', type: 'sketch', name: 'Эскиз основания', plane: 'XY', offset: 0,
      shapes: [{ type: 'rect', x: 0, y: 0, width: 120, height: 84, radius: 6 }] },
    { id: 'f1', type: 'extrude', name: 'Основание', sketchId: 's1', depth: 10, spacing: 0 },
    { id: 's2', type: 'sketch', name: 'Эскиз стенки', plane: 'XZ', offset: -42,
      shapes: [{ type: 'rect', x: 0, y: 32, width: 120, height: 64, radius: 6 }] },
    { id: 'f2', type: 'extrude', name: 'Вертикальная стенка', sketchId: 's2', depth: 10, spacing: 0 },
    { id: 's3', type: 'sketch', name: 'Эскиз ребра', plane: 'YZ', offset: -52,
      shapes: [{ type: 'polygon', points: [[-17, 9], [34, 9], [34, 53], [30, 53], [-17, 14]] }] },
    { id: 'f3', type: 'extrude', name: 'Рёбра жёсткости', sketchId: 's3', depth: 6, spacing: 98 },
    { id: 's4', type: 'sketch', name: 'Эскиз отверстий', plane: 'XY', offset: 11,
      shapes: [[-39, -25], [39, -25], [-35, 13], [35, 13]].map(([x, y]) => ({ type: 'circle', x, y, radius: 6.5 })) },
    { id: 'f4', type: 'hole', name: 'Отверстия основания', sketchId: 's4', depth: 12, spacing: 0, reverse: true },
    { id: 's5', type: 'sketch', name: 'Эскиз крепления', plane: 'XZ', offset: -43,
      shapes: [-29, 29].map((x) => ({ type: 'circle', x, y: 43, radius: 8 })) },
    { id: 'f5', type: 'hole', name: 'Отверстия стенки', sketchId: 's5', depth: 12, spacing: 0 },
  ];
  return project;
}

export function sketchFor(project, feature) {
  return project.features.find((entry) => entry.id === feature.sketchId && entry.type === 'sketch');
}

function isLength(value) {
  return Number.isFinite(value) && Math.abs(value) <= 100000;
}

function isPositiveLength(value) {
  return isLength(value) && value >= 0.01;
}

function validShape(shape) {
  if (shape?.type === 'polygon') {
    return Array.isArray(shape.points) && shape.points.length >= 3 && shape.points.length <= 500 &&
      shape.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(isLength));
  }
  if (!isLength(shape?.x) || !isLength(shape?.y)) return false;
  if (shape.type === 'circle') return isPositiveLength(shape.radius);
  return shape.type === 'rect' && isPositiveLength(shape.width) && isPositiveLength(shape.height) &&
    isLength(shape.radius) && shape.radius >= 0 && shape.radius <= Math.min(shape.width, shape.height) / 2;
}

export function validateProject(project) {
  if (project?.format !== 'rnx-cad' || project.version !== 1 || !Object.hasOwn(MATERIALS, project.material) ||
      typeof project.name !== 'string' || !project.name.trim() || project.name.length > 120 ||
      !Array.isArray(project.features) || project.features.length > 250) {
    throw new Error('Формат проекта не поддерживается. Выберите файл .rnx.');
  }
  const seen = new Map();
  for (const feature of project.features) {
    if (!feature || typeof feature.id !== 'string' || !feature.id || seen.has(feature.id) ||
        typeof feature.name !== 'string' || !feature.name.trim() || feature.name.length > 120 || !Object.hasOwn(FEATURES, feature.type)) {
      throw new Error('Некорректная запись в дереве построения.');
    }
    if (feature.type === 'sketch') {
      if (!Object.hasOwn(PLANES, feature.plane) || !isLength(feature.offset) || !Array.isArray(feature.shapes) ||
          !feature.shapes.length || feature.shapes.length > 150 || !feature.shapes.every(validShape)) {
        throw new Error(`Проверьте параметры эскиза «${feature.name}».`);
      }
    } else if (seen.get(feature.sketchId)?.type !== 'sketch' || !isPositiveLength(feature.depth) || !isLength(feature.spacing ?? 0) ||
               (feature.type === 'hole' && seen.get(feature.sketchId).shapes.some((shape) => shape.type !== 'circle'))) {
      throw new Error(`Проверьте параметры операции «${feature.name}».`);
    }
    seen.set(feature.id, feature);
  }
  return project;
}

export function shapePoints(shape) {
  if (shape.type === 'polygon') return shape.points;
  if (shape.type === 'circle') {
    return Array.from({ length: 72 }, (_, index) => {
      const angle = index * Math.PI / 36;
      return [shape.x + Math.cos(angle) * shape.radius, shape.y + Math.sin(angle) * shape.radius];
    });
  }
  const { x, y, width, height, radius } = shape;
  const right = x + width / 2;
  const left = x - width / 2;
  const top = y + height / 2;
  const bottom = y - height / 2;
  if (!radius) return [[right, top], [left, top], [left, bottom], [right, bottom]];
  const corners = [[right - radius, top - radius], [left + radius, top - radius],
    [left + radius, bottom + radius], [right - radius, bottom + radius]];
  return corners.flatMap(([cx, cy], corner) => Array.from({ length: 13 }, (_, index) => {
    const angle = (corner + index / 12) * Math.PI / 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }));
}

export function number(value, digits = 1) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}
