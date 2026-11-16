import '@fontsource-variable/inter';
import './style.css';
import { demoProject, FEATURES, MATERIALS, newProject, number, PLANES, SHAPES, sketchFor } from './model.js';
import { binaryStl, initKernel } from './kernel.js';
import { createViewport } from './viewport.js';
import { createSketchEditor } from './sketch.js';
import { button, escape, field, icon, menuItem, select, shell } from './ui.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rnx-cad.project.v1';
const VIEWS = { iso: 'Изометрия', front: 'Спереди', top: 'Сверху', right: 'Справа', back: 'Сзади', left: 'Слева', bottom: 'Снизу', free: 'Произвольный вид' };
const DISPLAYS = { edges: 'Поверхности и рёбра', solid: 'Затенённый вид', wire: 'Рёбра' };
const TOOLS = {
  select: { label: 'Выбор', icon: 'mouse-pointer-2', shortcut: 'V', hint: 'Выберите контур, чтобы изменить его размеры' },
  rect: { ...SHAPES.rect, shortcut: 'R', hint: 'Укажите два противоположных угла' },
  circle: { ...SHAPES.circle, shortcut: 'C', hint: 'Укажите центр и точку на окружности' },
  polygon: { ...SHAPES.polygon, shortcut: 'L', hint: 'Укажите вершины и замкните контур кликом по первой точке или нажмите Enter' },
  pan: { label: 'Панорама', icon: 'hand', shortcut: 'H', hint: 'Перетащите рабочую область' },
};

$('app').innerHTML = shell();
let kernel;
let mesh;
let project = demoProject();
let selected = 'part';
let tab = 'model';
let view = 'iso';
let display = 'edges';
let showGrid = true;
let snap = true;
let pan = false;
let treeVisible = innerWidth > 720;
let inspectorVisible = innerWidth > 720;
let editor;
let activeMenu;
let dialogSubmit;
let appError;
const expanded = new Set();
const past = [];
const future = [];

let viewport;
try {
  viewport = createViewport($('model-canvas'), $('orientation-cube'), [...document.querySelectorAll('.axis')], () => {
    view = 'free';
    viewport.setFree();
    renderViewLabel();
  });
} catch (error) {
  console.error(error);
  appError = 'Для просмотра 3D включите аппаратное ускорение или откройте приложение в браузере с WebGL 2.';
}

const sketch = createSketchEditor($('sketch-canvas'), {
  shape(shape) {
    changeDraft(() => { editor.draft.shapes.push(shape); editor.selected = editor.draft.shapes.length - 1; });
  },
  select(index) { editor.selected = index; updateDraft(); },
  cursor([x, y]) { $('coordinates').textContent = `X ${number(x, 2)}   Y ${number(y, 2)}`; },
});

function showToast(message, kind = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.innerHTML = `${icon(kind === 'success' ? 'check' : 'triangle-alert')}<span>${escape(message)}</span>`;
  $('toasts').append(element);
  setTimeout(() => element.remove(), kind === 'success' ? 2800 : 5500);
}

function autosave() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); }
  catch (error) { console.warn('Не удалось сохранить проект в локальном хранилище.', error); }
}

function setProject(next, id, reframe, result = kernel.build(next), refresh = render) {
  project = next;
  mesh = result;
  selected = project.features.some((feature) => feature.id === id) || id.startsWith('plane-') || id === 'origin' ? id : 'part';
  viewport?.updateModel(mesh, MATERIALS[project.material].color, reframe);
  autosave();
  refresh();
}

function syncHistoryButtons() {
  const ribbon = $('ribbon-tools');
  ribbon.querySelector('[data-action=undo]')?.toggleAttribute('disabled', !(editor ? editor.past.length : past.length));
  ribbon.querySelector('[data-action=redo]')?.toggleAttribute('disabled', !(editor ? editor.future.length : future.length));
}

function commit(next, id = selected, reframe = false, result, refresh) {
  const previous = { project, selected };
  setProject(next, id, reframe, result, refresh);
  past.push(previous);
  if (past.length > 50) past.shift();
  future.length = 0;
  syncHistoryButtons();
}

function travel(from, to) {
  if (editor) {
    const fromDraft = from === past ? editor.past : editor.future;
    const toDraft = from === past ? editor.future : editor.past;
    if (!fromDraft.length) return;
    const previousPlane = editor.draft.plane;
    toDraft.push({ draft: editor.draft, selected: editor.selected });
    Object.assign(editor, fromDraft.pop());
    updateDraft(previousPlane !== editor.draft.plane);
    return;
  }
  const next = from.at(-1);
  if (!next) return;
  const previous = { project, selected };
  setProject(next.project, next.selected, true);
  from.pop();
  to.push(previous);
  syncHistoryButtons();
}

function current() {
  return project.features.find((item) => item.id === selected);
}

function setSelection(id) {
  if (editor || selected === id) return;
  selected = id;
  $('tree-content').querySelectorAll('[data-action=select]').forEach((target) => {
    const active = target.dataset.value === selected;
    (target.closest('.tree-row') ?? target).classList.toggle('selected', active);
    if (active) target.setAttribute('aria-current', 'true');
    else target.removeAttribute('aria-current');
  });
  renderInspector();
}

function row(action, iconName, name, id, options = {}) {
  const { child = false, toggle = '', open = false, muted = false, folder = false } = options;
  const classes = ['tree-row', child && 'tree-child', muted && 'muted', selected === id && 'selected'].filter(Boolean).join(' ');
  return `<div class="${classes}" data-node="${escape(id)}">
    ${toggle ? button('expand', open ? 'chevron-down' : 'chevron-right', `${open ? 'Свернуть' : 'Развернуть'} ${name}`,
      { className: 'tree-toggle', data: `data-value="${escape(toggle)}" aria-expanded="${open}"` }) : '<span class="tree-indent"></span>'}
    <button type="button" class="tree-label ${folder ? 'folder' : ''}" data-action="${action}" data-value="${escape(id)}" title="${escape(name)}"${selected === id ? ' aria-current="true"' : ''}>
      ${icon(iconName)}<span>${escape(name)}</span>${muted ? icon('eye-off') : ''}</button></div>`;
}

function renderTree() {
  const operationList = project.features.filter((feature) => feature.type !== 'sketch');
  const owners = new Map();
  for (const feature of operationList) if (!owners.has(feature.sketchId)) owners.set(feature.sketchId, feature.id);
  const operations = project.features.map((feature) => {
    if (feature.type === 'sketch') return owners.has(feature.id) ? '' : row('select', FEATURES.sketch.icon, feature.name, feature.id);
    const owned = owners.get(feature.sketchId) === feature.id;
    const open = expanded.has(feature.id);
    const operation = row('select', FEATURES[feature.type].icon, feature.name, feature.id,
      { toggle: owned ? feature.id : '', open, muted: feature.suppressed });
    const subsketch = sketchFor(project, feature);
    return operation + (owned && open ? row('select', FEATURES.sketch.icon, subsketch.name, subsketch.id, { child: true }) : '');
  }).join('');
  const planesOpen = expanded.has('planes');
  $('tree-content').innerHTML = `<button type="button" class="part-node ${selected === 'part' ? 'selected' : ''}" data-action="select" data-value="part">
      <span class="part-icon">${icon('box')}</span><span><strong>${escape(project.name)}</strong><small>Деталь</small></span>
    </button><div class="tree-items">
    ${row('select', 'axis-3d', 'Начало координат', 'origin', { folder: true })}
    ${row('expand', 'layers-2', 'Плоскости', 'planes', { toggle: 'planes', open: planesOpen, folder: true })}
    ${planesOpen ? Object.entries(PLANES).map(([id, plane]) => row('select', 'grid-2x2', plane.label, `plane-${id}`, { child: true, folder: true })).join('') : ''}
    ${operations}${editor?.isNew ? row('select', FEATURES.sketch.icon, editor.draft.name, editor.draft.id) : ''}</div>`;
  const count = operationList.length;
  const ending = new Intl.PluralRules('ru').select(count);
  $('tree-footer').innerHTML = `${icon('layers-2')}<span>${count} ${ending === 'one' ? 'операция' : ending === 'few' ? 'операции' : 'операций'}</span>`;
}

const group = (label, content) => `<div class="tool-group"><div>${content}</div><small>${label}</small></div>`;
function toolButton(action, iconName, label, options = {}) {
  return button(action, iconName, label, { ...options, text: true, className: `tool-button ${options.className ?? ''}` });
}

function renderRibbon() {
  for (const element of document.querySelectorAll('[data-action=tab]')) element.setAttribute('aria-selected', element.dataset.value === tab);
  const undo = toolButton('undo', 'undo-2', 'Отменить', { shortcut: 'Ctrl+Z', disabled: !(editor ? editor.past.length : past.length) });
  const redo = toolButton('redo', 'redo-2', 'Повторить', { shortcut: 'Ctrl+Y', disabled: !(editor ? editor.future.length : future.length) });
  const create = toolButton('start-sketch', 'pencil-ruler', 'Новый эскиз', { className: 'emphasis', shortcut: 'S', disabled: !kernel });
  const fit = toolButton('fit', 'scan', 'По размеру', { shortcut: 'F' });
  const grid = toolButton('grid', 'grid-2x2', 'Сетка', { data: `aria-pressed="${showGrid}"` });
  const operations = [
    ['extrude', 'Вытянуть', 'E'], ['cut', 'Вырезать', ''], ['hole', 'Отверстие', ''],
  ].map(([type, label, shortcut]) => toolButton('operation', FEATURES[type].icon, label, { data: `data-value="${type}"`, shortcut, disabled: !kernel })).join('');
  let content;
  if (tab === 'sketch') {
    const shapes = ['select', 'rect', 'circle', 'polygon'].map((key) => toolButton('sketch-tool', TOOLS[key].icon, TOOLS[key].label,
      { shortcut: TOOLS[key].shortcut, data: `data-value="${key}" aria-pressed="${editor?.tool === key}"`, disabled: !kernel })).join('');
    const finish = editor ? toolButton('finish-sketch', 'check', 'Завершить эскиз', { className: 'emphasis' }) + toolButton('cancel-sketch', 'x', 'Отмена', { shortcut: 'Esc' }) : create;
    content = group('Эскиз', finish) + group('Контур', shapes) + group('Правка', undo + redo);
  } else if (tab === 'view') {
    const views = ['iso', 'front', 'top', 'right'].map((id) => toolButton('orientation', 'box', VIEWS[id], { data: `data-value="${id}" aria-pressed="${!editor && id === view}"`, disabled: Boolean(editor) })).join('');
    content = group('Ориентация', views) + group('Отображение', fit + grid + toolButton('menu', 'eye', 'Стиль', { data: 'data-value="display" aria-haspopup="menu"', disabled: Boolean(editor) }));
  } else {
    content = group('Создание', editor ? toolButton('finish-sketch', 'check', 'Завершить эскиз', { className: 'emphasis' }) : create) +
      group('Операции', operations) + group('Правка', undo + redo) + group('Вид', fit + grid);
  }
  $('ribbon-tools').innerHTML = content;
}

function inspectorSection(label, html) {
  return `<section class="property-section"><h3>${label}</h3>${html}</section>`;
}

function metric(label, value, unit) {
  return `<div class="metric"><span>${label}</span><strong>${value === undefined ? '—' : number(value, 2)}${value === undefined ? '' : `<small>${unit}</small>`}</strong></div>`;
}

function identity(iconName, title, subtitle) {
  return `<div class="identity"><span class="identity-icon">${icon(iconName)}</span>
    <span><strong>${escape(title)}</strong><small>${escape(subtitle)}</small></span></div>`;
}

function partInspector() {
  const sizes = mesh?.bounds.max.map((max, index) => max - mesh.bounds.min[index]) ?? [];
  const material = MATERIALS[project.material];
  const properties = `<form id="part-form">
    ${field('name', 'Название', project.name)}
    <div class="material" style="--swatch:${material.color}">${select('material', 'Материал', Object.entries(MATERIALS).map(([id, value]) => [id, value.label]), project.material)}</div>
    </form>`;
  return identity('box', 'Свойства детали', 'Документ детали') + inspectorSection('Основные', properties) +
    inspectorSection('Габариты', `<div class="metrics">${metric('Ширина (X)', sizes[0], 'мм')}${metric('Глубина (Y)', sizes[1], 'мм')}${metric('Высота (Z)', sizes[2], 'мм')}</div>`) +
    inspectorSection('Физические свойства', `<div class="metrics">${metric('Объём', mesh ? mesh.volume / 1000 : undefined, 'см³')}${metric('Масса', mesh ? mesh.volume * material.density / 1000 : undefined, 'г')}</div>`);
}

function shapeFields(shape) {
  const numeric = { numeric: true, unit: 'мм' };
  if (shape.type === 'polygon') return `<div class="vertex-list">${shape.points.map(([x, y], index) =>
    `<div class="field-pair">${field(`x${index}`, `X${index + 1}`, x, numeric)}${field(`y${index}`, `Y${index + 1}`, y, numeric)}</div>`).join('')}</div>`;
  const position = `<div class="field-pair">${field('x', 'Центр X', shape.x, numeric)}${field('y', 'Центр Y', shape.y, numeric)}</div>`;
  const size = shape.type === 'rect' ? `<div class="field-pair">${field('width', 'Ширина', shape.width, { ...numeric, min: 0.01 })}${field('height', 'Высота', shape.height, { ...numeric, min: 0.01 })}</div>` : '';
  return position + size + field('radius', shape.type === 'circle' ? 'Радиус' : 'Радиус углов', shape.radius,
    { ...numeric, min: shape.type === 'circle' ? 0.01 : 0 });
}

function draftInspector() {
  const { draft, selected: index } = editor;
  const shape = draft.shapes[index];
  return identity('pencil-ruler', draft.name, 'Редактирование эскиза') + inspectorSection('Положение', `<form id="sketch-form">
    ${field('name', 'Название', draft.name)}
    ${select('plane', 'Плоскость', Object.entries(PLANES).map(([id, plane]) => [id, plane.label]), draft.plane)}
    ${field('offset', 'Смещение от плоскости', draft.offset, { numeric: true, unit: 'мм', min: -100000, max: 100000 })}
    </form>`) + inspectorSection('Контуры', draft.shapes.length ? `<div class="shape-list">${draft.shapes.map((item, i) =>
      `<div class="shape-row ${i === index ? 'selected' : ''}">${button('select-shape', SHAPES[item.type].icon, `${SHAPES[item.type].label} ${i + 1}`,
        { text: true, data: `data-value="${i}"` })}${button('delete-shape', 'trash-2', 'Удалить контур', { className: 'icon-button', data: `data-value="${i}"` })}</div>`).join('')}</div>` : '<p class="quiet-text">Нарисуйте замкнутый контур в рабочей области.</p>') +
    (shape ? inspectorSection('Геометрия контура', `<form id="shape-form">${shapeFields(shape)}<button class="secondary" type="submit">Применить размеры</button></form>`) : '');
}

function operationFields(feature) {
  return field('name', 'Название', feature.name) +
    field('depth', feature.type === 'extrude' ? 'Высота' : 'Глубина', feature.depth, { numeric: true, unit: 'мм', min: 0.01, max: 100000 }) +
    select('direction', 'Направление', [['normal', 'По нормали'], ['reverse', 'Обратное']], feature.reverse ? 'reverse' : 'normal') +
    field('spacing', 'Смещение второй копии', feature.spacing ?? 0, { numeric: true, unit: 'мм', min: -100000, max: 100000 });
}

function featureInspector(feature) {
  const info = FEATURES[feature.type];
  const remove = button('delete', 'trash-2', 'Удалить', { className: 'secondary danger', text: true });
  if (feature.type === 'sketch') return identity(info.icon, feature.name, info.label) + inspectorSection('Положение',
    `<div class="metrics"><div class="metric"><span>Плоскость</span><strong>${PLANES[feature.plane].label}</strong></div>${metric('Смещение', feature.offset, 'мм')}${metric('Контуры', feature.shapes.length, '')}</div>`) +
    `<div class="inspector-actions">${button('edit-sketch', info.icon, 'Редактировать эскиз', { className: 'primary', text: true, data: `data-value="${escape(feature.id)}"` })}${remove}</div>`;
  const source = sketchFor(project, feature);
  return identity(info.icon, feature.name, feature.suppressed ? `${info.label} · Погашено` : info.label) +
    inspectorSection('Параметры', `<form id="feature-form">${operationFields(feature)}<button type="submit" class="primary">Применить</button></form>`) +
    inspectorSection('Исходный эскиз', button('edit-sketch', 'pencil-ruler', source.name, { className: 'secondary', text: true, data: `data-value="${escape(source.id)}"` })) +
    `<div class="inspector-actions">${button('suppress', feature.suppressed ? 'eye' : 'eye-off', feature.suppressed ? 'Включить операцию' : 'Погасить операцию', { className: 'secondary', text: true })}${remove}</div>`;
}

function renderInspector() {
  const feature = current();
  $('inspector-title').textContent = editor ? 'Эскиз' : 'Свойства';
  let content;
  if (editor) content = draftInspector();
  else if (feature) content = featureInspector(feature);
  else if (selected.startsWith('plane-')) {
    const planeName = selected.slice(6);
    const plane = PLANES[planeName];
    content = identity('grid-2x2', plane.label, 'Опорная плоскость') + `<div class="inspector-actions">${button('start-sketch', 'pencil-ruler', 'Новый эскиз', { className: 'primary', text: true, data: `data-value="${planeName}"` })}</div>`;
  } else if (selected === 'origin') {
    content = identity('axis-3d', 'Начало координат', 'Мировая система координат') +
      inspectorSection('Координаты', `<div class="metrics">${['X', 'Y', 'Z'].map((label) => metric(label, 0, 'мм')).join('')}</div>`);
  } else content = partInspector();
  const panel = $('inspector-content');
  const previousScroll = panel.scrollTop;
  panel.innerHTML = content;
  panel.scrollTop = previousScroll;
}

function renderViewLabel() {
  $('view-badge').querySelector('span').textContent = VIEWS[view];
}

function renderStage() {
  $('model-canvas').hidden = Boolean(editor);
  $('sketch-canvas').hidden = !editor;
  $('orientation').hidden = Boolean(editor) || Boolean(appError);
  $('axis-widget').hidden = Boolean(editor) || Boolean(appError);
  $('view-badge').hidden = Boolean(editor);
  $('sketch-badge').hidden = !editor;
  if (editor) $('sketch-badge').querySelector('span').textContent = `${editor.draft.name} · ${editor.draft.plane}`;
  renderViewLabel();
  const floating = (action, iconName, label, data = '', shortcut = '') => button(action, iconName, label, { className: 'icon-button', data, shortcut });
  $('canvas-tools').innerHTML = editor ?
    floating('sketch-tool', 'mouse-pointer-2', 'Выбор', `data-value="select" aria-pressed="${editor.tool === 'select'}"`, 'V') +
    floating('sketch-tool', 'hand', 'Панорама', `data-value="pan" aria-pressed="${editor.tool === 'pan'}"`, 'H') +
    floating('fit', 'scan', 'По размеру', '', 'F') + '<i></i>' +
    floating('grid', 'grid-2x2', 'Сетка', `aria-pressed="${showGrid}"`) + floating('snap', 'crosshair', 'Привязка к шагу 1 мм', `aria-pressed="${snap}"`) :
    floating('orbit', 'rotate-3d', 'Вращение', `aria-pressed="${!pan}"`) +
    floating('pan', 'hand', 'Панорама', `aria-pressed="${pan}"`, 'H') + floating('fit', 'scan', 'По размеру', '', 'F') + '<i></i>' +
    floating('grid', 'grid-2x2', 'Сетка', `aria-pressed="${showGrid}"`) +
    `<button type="button" class="icon-button style-button" data-action="menu" data-value="display" aria-haspopup="menu" title="Стиль отображения" aria-label="Стиль отображения">${icon('eye')}${icon('chevron-down')}</button>`;
  const message = $('stage-message');
  message.hidden = Boolean(editor) || (Boolean(mesh) && !appError);
  if (!message.hidden) {
    const text = appError ?? (kernel ? 'Создайте эскиз и вытяните его, чтобы получить деталь.' : 'Загрузка геометрии…');
    message.innerHTML = `<span>${icon(appError ? 'triangle-alert' : 'box')}</span><p>${escape(text)}</p>${kernel && !appError ?
      button('start-sketch', 'pencil-ruler', 'Новый эскиз', { className: 'primary', text: true }) : ''}`;
  }
  $('coordinates').hidden = !editor;
  $('status-hint').textContent = editor ? TOOLS[editor.tool].hint : 'ЛКМ — вращение  ·  ПКМ — панорама  ·  Колесо — масштаб';
}

function renderDocumentTitle() {
  $('document-name').textContent = project.name;
  document.title = `${project.name} — Rnx CAD`;
}

function render() {
  $('app').classList.toggle('tree-hidden', !treeVisible);
  $('app').classList.toggle('inspector-hidden', !inspectorVisible);
  renderDocumentTitle();
  document.querySelector('.export-button').disabled = !mesh;
  document.querySelector('.title-save').disabled = !kernel;
  $('status-ready').classList.toggle('ready', Boolean(kernel));
  $('status-ready').querySelector('span').textContent = kernel ? (editor ? 'Редактор эскиза' : 'Готово') : 'Загрузка геометрии';
  renderRibbon();
  renderTree();
  renderInspector();
  renderStage();
}

function startSketch(source, pending, tool = 'select', plane) {
  if (!kernel) return;
  if (editor) { setTool(tool); return; }
  const count = project.features.filter((feature) => feature.type === 'sketch').length;
  const draft = source ? structuredClone(source) : { id: crypto.randomUUID(), type: 'sketch', name: `Эскиз ${count + 1}`,
    plane: plane ?? (selected.startsWith('plane-') ? selected.slice(6) : 'XY'), offset: 0, shapes: [] };
  editor = { draft, isNew: !source, pending, tool, selected: -1, previousSelection: selected, past: [], future: [] };
  if (source) {
    const owner = project.features.find((feature) => feature.sketchId === source.id);
    if (owner) expanded.add(owner.id);
  }
  selected = draft.id;
  tab = 'sketch';
  inspectorVisible = true;
  viewport?.setActive(false);
  render();
  sketch.setTool(tool);
  sketch.start(draft, mesh);
  $('coordinates').textContent = 'X 0   Y 0';
}

function setTool(tool) {
  if (!editor) { startSketch(undefined, undefined, tool); return; }
  editor.tool = tool;
  sketch.setTool(tool);
  renderRibbon();
  renderStage();
}

function updateDraft(reproject = false) {
  sketch.update(editor.draft, editor.selected);
  if (reproject) sketch.reproject(mesh);
  renderRibbon();
  renderTree();
  renderInspector();
  renderStage();
}

function changeDraft(mutate, reproject = false, fieldOnly = false) {
  editor.past.push({ draft: structuredClone(editor.draft), selected: editor.selected });
  if (editor.past.length > 50) editor.past.shift();
  editor.future.length = 0;
  mutate();
  if (fieldOnly) {
    sketch.update(editor.draft, editor.selected);
    if (reproject) sketch.reproject(mesh);
    $('sketch-badge').querySelector('span').textContent = `${editor.draft.name} · ${editor.draft.plane}`;
    $('inspector-content').querySelector('.identity strong').textContent = editor.draft.name;
    syncHistoryButtons();
    renderTree();
  } else updateDraft(reproject);
}

function exitSketch(id) {
  editor = null;
  tab = 'model';
  selected = id;
  viewport?.setActive(true);
  render();
}

function finishSketch() {
  if (!editor) return;
  sketch.finishPolygon();
  const { draft, pending, isNew } = editor;
  if (!draft.shapes.length) throw new Error('Добавьте хотя бы один замкнутый контур.');
  const features = isNew ? [...project.features, draft] : project.features.map((item) => item.id === draft.id ? draft : item);
  commit({ ...project, features }, draft.id);
  exitSketch(draft.id);
  if (pending) openOperation(pending, draft);
}

function openOperation(type, source) {
  if (!kernel) return;
  if (editor) { editor.pending = type; finishSketch(); return; }
  const item = current();
  const sketchItem = source ?? (item?.type === 'sketch' ? item : item && sketchFor(project, item)) ??
    project.features.findLast((entry) => entry.type === 'sketch' && !project.features.some((feature) => feature.sketchId === entry.id));
  if (!sketchItem) { startSketch(undefined, type, type === 'hole' ? 'circle' : 'rect'); return; }
  if (type === 'hole' && sketchItem.shapes.some((shape) => shape.type !== 'circle')) throw new Error('Для отверстия выберите эскиз из окружностей.');
  if (type !== 'extrude' && !mesh) throw new Error('Сначала создайте тело вытягиванием эскиза.');
  const count = project.features.filter((feature) => feature.type === type).length + 1;
  const normal = PLANES[sketchItem.plane].normal;
  const midplane = mesh ? normal.reduce((distance, axis, dim) => distance + axis * (mesh.bounds.min[dim] + mesh.bounds.max[dim]) / 2, 0) : 0;
  const reverse = type !== 'extrude' && sketchItem.offset >= midplane;
  const feature = { id: crypto.randomUUID(), type, name: `${FEATURES[type].label} ${count}`, sketchId: sketchItem.id, depth: 10, spacing: 0, reverse };
  openDialog(FEATURES[type].label,
    `<p class="dialog-note">Эскиз «${escape(sketchItem.name)}» · ${sketchItem.plane}</p>${operationFields(feature)}`, 'Создать', (data) => {
      applyOperationFields(feature, data);
      const next = { ...project, features: [...project.features, feature] };
      const result = kernel.build(next);
      if (type !== 'extrude' && result && Math.abs(mesh.volume - result.volume) < 0.000001) {
        throw new Error('Контур не пересекает тело. Проверьте направление, глубину и положение эскиза.');
      }
      expanded.add(feature.id);
      commit(next, feature.id, true, result);
    });
}

function applyOperationFields(feature, data) {
  Object.assign(feature, { name: data.get('name').trim(), depth: Number(data.get('depth')), spacing: Number(data.get('spacing')), reverse: data.get('direction') === 'reverse' });
}

function deleteFeature() {
  if (editor) {
    if (editor.selected >= 0) deleteShape(editor.selected);
    return;
  }
  const feature = current();
  if (!feature) return;
  const dependants = project.features.filter((item) => item.sketchId === feature.id);
  const remove = () => commit({ ...project, features: project.features.filter((item) => item.id !== feature.id && item.sketchId !== feature.id) }, 'part');
  if (!dependants.length) remove();
  else openDialog('Удаление эскиза', `<p class="dialog-note">Операции ${dependants.map((item) => `«${escape(item.name)}»`).join(', ')} используют этот эскиз и будут удалены вместе с ним.</p>`, 'Удалить', remove);
}

function deleteShape(index) {
  changeDraft(() => { editor.draft.shapes.splice(index, 1); editor.selected = -1; });
}

function openDialog(title, content, label, submit) {
  dialogSubmit = submit;
  $('dialog').innerHTML = `<form id="dialog-form"><div class="dialog-header"><h2>${escape(title)}</h2>
    ${button('close-dialog', 'x', 'Закрыть', { className: 'icon-button quiet' })}</div>
    <div class="dialog-body">${content}<p class="form-error" role="alert" hidden></p></div>
    <footer><button type="button" class="secondary" data-action="close-dialog">Отмена</button><button type="submit" class="primary">${label}</button></footer></form>`;
  $('dialog').showModal();
  $('dialog').querySelector('input')?.focus();
  $('dialog').querySelector('input[type=text]')?.select();
}

function download(data, type, extension) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function closeMenu() {
  if (activeMenu?.anchor) activeMenu.anchor.setAttribute('aria-expanded', 'false');
  activeMenu = null;
  $('popup').hidden = true;
}

function openMenu(value, anchor, location) {
  if (activeMenu?.value === value && activeMenu.anchor === anchor && !location) { closeMenu(); return; }
  closeMenu();
  const separator = '<hr>';
  const choices = {
    file: () => menuItem('new', 'file-plus', 'Новая деталь', 'Ctrl+N', '', !kernel || Boolean(editor)) +
      menuItem('open', 'folder-open', 'Открыть проект', 'Ctrl+O', '', !kernel || Boolean(editor)) +
      menuItem('save', 'save', 'Сохранить проект', 'Ctrl+S', '', !kernel) +
      menuItem('export', 'download', 'Экспорт STL', '', '', !mesh) + separator + menuItem('demo', 'box', 'Опорный кронштейн', '', '', !kernel || Boolean(editor)),
    edit: () => menuItem('undo', 'undo-2', 'Отменить', 'Ctrl+Z', '', !(editor ? editor.past.length : past.length)) +
      menuItem('redo', 'redo-2', 'Повторить', 'Ctrl+Y', '', !(editor ? editor.future.length : future.length)) + separator +
      menuItem('delete', 'trash-2', 'Удалить', 'Del', '', editor ? editor.selected < 0 : !current()),
    view: () => menuItem('fit', 'scan', 'По размеру', 'F') + menuItem('grid', showGrid ? 'check' : 'grid-2x2', 'Сетка') + separator +
      menuItem('toggle-tree', 'panel-left-open', treeVisible ? 'Скрыть дерево' : 'Показать дерево') +
      menuItem('toggle-inspector', 'panel-right-open', inspectorVisible ? 'Скрыть свойства' : 'Показать свойства'),
    orientation: () => Object.entries(VIEWS).filter(([id]) => id !== 'free').map(([id, title]) =>
      menuItem('orientation', id === view ? 'check' : 'box', title, '', `data-value="${id}"`)).join(''),
    display: () => Object.entries(DISPLAYS).map(([id, title]) => menuItem('display', id === display ? 'check' : 'eye', title, '', `data-value="${id}"`)).join(''),
    feature: () => {
      const item = current();
      return (item.type === 'sketch' ? menuItem('edit-sketch', 'pencil-ruler', 'Редактировать эскиз', '', `data-value="${escape(item.id)}"`) :
        menuItem('suppress', item.suppressed ? 'eye' : 'eye-off', item.suppressed ? 'Включить операцию' : 'Погасить операцию')) +
        menuItem('delete', 'trash-2', 'Удалить', 'Del');
    },
  };
  const popup = $('popup');
  popup.innerHTML = choices[value]();
  popup.hidden = false;
  const rect = anchor?.getBoundingClientRect();
  const x = location?.x ?? rect.left;
  const below = location?.y ?? rect.bottom + 6;
  const y = below + popup.offsetHeight < innerHeight - 8 ? below : (location?.y ?? rect.top) - popup.offsetHeight - 6;
  popup.style.left = `${Math.max(8, Math.min(x, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, y)}px`;
  activeMenu = { value, anchor };
  anchor?.setAttribute('aria-expanded', 'true');
  if (anchor?.matches(':focus-visible')) popup.querySelector('button:not(:disabled)')?.focus();
}

const actions = {
  menu: (value, anchor) => openMenu(value, anchor),
  tab(value) { tab = value; renderRibbon(); },
  select: setSelection,
  expand(value) { if (expanded.has(value)) expanded.delete(value); else expanded.add(value); renderTree(); },
  'toggle-tree'() { treeVisible = !treeVisible; render(); },
  'toggle-inspector'() { inspectorVisible = !inspectorVisible; render(); },
  'start-sketch': (plane) => startSketch(undefined, undefined, 'select', plane),
  'edit-sketch': (id) => startSketch(project.features.find((item) => item.id === id && item.type === 'sketch')),
  'sketch-tool': setTool,
  'finish-sketch': finishSketch,
  'cancel-sketch'() { if (editor) exitSketch(editor.previousSelection); },
  'select-shape'(value) { if (editor) { editor.selected = Number(value); updateDraft(); } },
  'delete-shape': (value) => deleteShape(Number(value)),
  orientation(value) { view = value; viewport?.setView(view); renderViewLabel(); renderRibbon(); },
  display(value) { display = value; viewport?.setDisplay(value); },
  fit() { if (editor) sketch.fit(); else viewport?.fit(); },
  grid() { showGrid = !showGrid; viewport?.setGrid(showGrid); sketch.setGrid(showGrid); renderRibbon(); renderStage(); },
  snap() { snap = !snap; sketch.setSnap(snap); renderStage(); },
  orbit() { pan = false; viewport?.setPan(pan); renderStage(); },
  pan() { if (editor) { setTool('pan'); return; } pan = !pan; viewport?.setPan(pan); renderStage(); },
  undo: () => travel(past, future),
  redo: () => travel(future, past),
  delete: deleteFeature,
  suppress() {
    const item = current();
    if (!item || item.type === 'sketch') return;
    commit({ ...project, features: project.features.map((feature) => feature === item ? { ...feature, suppressed: !feature.suppressed } : feature) });
  },
  new() {
    if (!kernel || editor) return;
    openDialog('Новая деталь', field('name', 'Название', 'Новая деталь'), 'Создать', (data) => {
      const name = data.get('name').trim();
      if (!name) throw new Error('Введите название детали.');
      commit(newProject(name), 'part', true);
    });
  },
  open() { if (kernel && !editor) $('open-file').click(); },
  demo() { if (kernel && !editor) commit(demoProject(), 'part', true); },
  save() { if (kernel) download(JSON.stringify(project, null, 2), 'application/json', 'rnx'); },
  export() { if (mesh) download(binaryStl(mesh), 'model/stl', 'stl'); },
  'close-dialog'() { $('dialog').close(); },
};

function act(action, value, anchor) {
  try {
    if (action !== 'menu') closeMenu();
    if (action === 'operation') openOperation(value);
    else actions[action]?.(value, anchor);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target && !target.disabled) act(target.dataset.action, target.dataset.value, target);
  else if (!event.target.closest('#popup')) closeMenu();
});

$('tree-content').addEventListener('dblclick', (event) => {
  const feature = current();
  if (event.target.closest('.tree-label') && feature?.type === 'sketch') act('edit-sketch', feature.id);
});
$('tree-content').addEventListener('contextmenu', (event) => {
  const id = event.target.closest('[data-node]')?.dataset.node;
  if (!editor && project.features.some((item) => item.id === id)) {
    event.preventDefault();
    setSelection(id);
    openMenu('feature', null, { x: event.clientX, y: event.clientY });
  }
});

$('open-file').addEventListener('change', async ({ target }) => {
  const file = target.files[0];
  target.value = '';
  if (!file) return;
  try {
    if (file.size > 10_000_000) throw new Error('Файл проекта превышает 10 МБ.');
    const data = JSON.parse(await file.text());
    if (editor) return;
    commit(data, 'part', true);
    showToast(`Открыт проект «${project.name}»`);
  } catch (error) {
    showToast(error instanceof SyntaxError ? 'Не удалось прочитать файл проекта.' : error.message, 'error');
  }
});

document.addEventListener('change', (event) => {
  const input = event.target;
  try {
    if (!input.form || !input.reportValidity()) return;
    if (input.form.id === 'part-form') {
      const name = input.name === 'name' ? input.value.trim() : project.name;
      const material = input.name === 'material' ? input.value : project.material;
      if (name !== project.name || material !== project.material) {
        commit({ ...project, name, material }, 'part', false, undefined, () => {
          renderDocumentTitle();
          $('tree-content').querySelector('.part-node strong').textContent = project.name;
          if (input.name === 'material') renderInspector();
          else input.value = project.name;
        });
      }
    }
    if (input.form.id === 'sketch-form') {
      const value = input.name === 'offset' ? input.valueAsNumber : input.value.trim();
      if (input.name === 'name' && !value) throw new Error('Введите название эскиза.');
      if (editor.draft[input.name] !== value) changeDraft(() => { editor.draft[input.name] = value; }, input.name === 'plane', true);
    }
  } catch (error) {
    showToast(error.message, 'error');
    renderInspector();
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  const data = new FormData(form);
  event.preventDefault();
  try {
    if (form.id === 'dialog-form') {
      dialogSubmit(data);
      $('dialog').close();
    } else if (form.id === 'feature-form') {
      const original = current();
      const feature = { ...original };
      applyOperationFields(feature, data);
      commit({ ...project, features: project.features.map((item) => item === original ? feature : item) });
    } else if (form.id === 'shape-form') {
      const shape = structuredClone(editor.draft.shapes[editor.selected]);
      if (shape.type === 'polygon') shape.points = shape.points.map((_, i) => [Number(data.get(`x${i}`)), Number(data.get(`y${i}`))]);
      else for (const [name, value] of data) shape[name] = Number(value);
      if (shape.type === 'rect' && shape.radius > Math.min(shape.width, shape.height) / 2) throw new Error('Радиус углов не должен превышать половину меньшей стороны.');
      changeDraft(() => { editor.draft.shapes[editor.selected] = shape; });
    } else if (form.id === 'part-form' || form.id === 'sketch-form') {
      document.activeElement.blur();
    }
  } catch (error) {
    if (form.id === 'dialog-form') {
      const message = form.querySelector('.form-error');
      message.textContent = error.message;
      message.hidden = false;
    } else showToast(error.message, 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if ($('dialog').open) return;
  if (activeMenu && ['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'Escape') { activeMenu.anchor?.focus(); closeMenu(); return; }
    const buttons = [...$('popup').querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const step = event.key === 'ArrowUp' ? -1 : 1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
    return;
  }
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (event.target.matches('input, select, textarea, [contenteditable]')) {
    if (!command || !['n', 'o', 's'].includes(key)) return;
    event.target.blur();
  }
  let action;
  let value;
  if (command) {
    action = { n: 'new', o: 'open', s: 'save', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[key];
  } else if (key === 'escape' && editor) {
    if (!sketch.cancelGesture()) setTool('select');
    return;
  } else if (key === 'enter' && editor && !event.target.closest('button')) {
    sketch.finishPolygon();
    return;
  } else if (editor && ['v', 'r', 'c', 'l', 'h'].includes(key)) {
    action = 'sketch-tool';
    value = { v: 'select', r: 'rect', c: 'circle', l: 'polygon', h: 'pan' }[key];
  } else {
    action = { f: 'fit', s: 'start-sketch', e: 'operation', h: 'pan', delete: 'delete' }[key];
    if (key === 'e') value = 'extrude';
  }
  if (action) { event.preventDefault(); act(action, value); }
});

render();
try {
  kernel = await initKernel();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProject(JSON.parse(saved), 'part', true);
    else setProject(project, 'part', true);
  } catch (error) {
    console.warn(error);
    setProject(demoProject(), 'part', true);
    showToast('Не удалось восстановить последний проект. Открыт пример.', 'error');
  }
} catch (error) {
  console.error(error);
  appError = 'Не удалось запустить модуль геометрии. Перезапустите приложение.';
  renderStage();
  $('status-ready').querySelector('span').textContent = 'Ошибка геометрии';
}
