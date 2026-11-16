const files = import.meta.glob('/node_modules/lucide-static/icons/{axis-3d,box,check,chevron-down,chevron-right,circle,circle-dot,crosshair,download,eye,eye-off,file,file-plus,folder-open,grid-2x2,hand,layers-2,mouse-pointer-2,panel-left-close,panel-left-open,panel-right-close,panel-right-open,pencil-ruler,pentagon,redo-2,rotate-3d,ruler,save,scan,square,square-minus,trash-2,triangle-alert,undo-2,x}.svg', { eager: true, import: 'default', query: '?raw' });

export function icon(name) {
  return files[`/node_modules/lucide-static/icons/${name}.svg`] ?? '';
}

export function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function button(action, name, label, options = {}) {
  const { className = '', text = false, disabled = false, data = '', shortcut = '' } = options;
  return `<button type="button" class="${className}" data-action="${action}" ${data} ${disabled ? 'disabled' : ''}
    title="${escape(label + (shortcut ? ` (${shortcut})` : ''))}" aria-label="${escape(label)}">${icon(name)}${text ? `<span>${escape(label)}</span>` : ''}</button>`;
}

export function field(name, label, value, options = {}) {
  const { numeric = false, min, max, unit = '', required = true } = options;
  return `<label class="field"><span>${escape(label)}</span><span class="field-input">
    <input name="${name}" type="${numeric ? 'number' : 'text'}" value="${escape(value)}" ${required ? 'required' : ''}
      ${numeric ? `step="any" ${min === undefined ? '' : `min="${min}"`} ${max === undefined ? '' : `max="${max}"`}` : 'maxlength="120"'}>
    ${unit ? `<span class="field-unit">${escape(unit)}</span>` : ''}</span></label>`;
}

export function select(name, label, options, selected) {
  return `<label class="field"><span>${escape(label)}</span><span class="field-input is-select"><select name="${name}">
    ${options.map(([value, text]) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(text)}</option>`).join('')}
    </select>${icon('chevron-down')}</span></label>`;
}

export function menuItem(action, name, label, shortcut = '', data = '', disabled = false) {
  return `<button type="button" role="menuitem" data-action="${action}" ${data} ${disabled ? 'disabled' : ''}>
    ${icon(name)}<span>${escape(label)}</span>${shortcut ? `<kbd>${escape(shortcut)}</kbd>` : ''}</button>`;
}

export function shell() {
  return `<header class="titlebar">
    <div class="title-left">
      <div class="brand"><span class="brand-icon">${icon('box')}</span><strong>Rnx <span>CAD</span></strong></div>
      <nav class="main-menu" aria-label="Главное меню">
        <button type="button" data-action="menu" data-value="file" aria-haspopup="menu">Файл</button>
        <button type="button" data-action="menu" data-value="edit" aria-haspopup="menu">Правка</button>
        <button type="button" data-action="menu" data-value="view" aria-haspopup="menu">Вид</button>
      </nav>
    </div>
    <div class="document-title">${icon('file')}<span id="document-name"></span></div>
    <div class="title-actions">
      ${button('save', 'save', 'Сохранить проект', { className: 'title-save', shortcut: 'Ctrl+S' })}
      ${button('export', 'download', 'Экспорт STL', { className: 'export-button', text: true })}
    </div>
  </header>
  <section class="ribbon" aria-label="Панель инструментов">
    <div class="ribbon-tabs" role="tablist" aria-label="Инструменты">
      <button role="tab" type="button" data-action="tab" data-value="model">Модель</button>
      <button role="tab" type="button" data-action="tab" data-value="sketch">Эскиз</button>
      <button role="tab" type="button" data-action="tab" data-value="view">Вид</button>
    </div>
    <div class="ribbon-tools" id="ribbon-tools"></div>
  </section>
  <main class="workspace">
    <aside class="panel tree-panel" id="tree-panel">
      <div class="panel-header"><h2>Дерево построения</h2>
        ${button('toggle-tree', 'panel-left-close', 'Скрыть дерево построения', { className: 'icon-button quiet' })}</div>
      <div class="panel-scroll tree-content" id="tree-content" aria-label="Дерево построения"></div>
      <div class="tree-footer" id="tree-footer"></div>
    </aside>
    <section class="stage" id="stage" aria-label="Графическая область">
      <div id="model-canvas" class="model-canvas"></div>
      <canvas id="sketch-canvas" class="sketch-canvas" aria-label="Редактор эскиза" hidden></canvas>
      <div class="stage-top">
        ${button('toggle-tree', 'panel-left-open', 'Показать дерево построения', { className: 'floating-icon reveal-tree' })}
        <button type="button" class="view-badge" data-action="menu" data-value="orientation" aria-haspopup="menu" id="view-badge">${icon('box')}<span>Изометрия</span>${icon('chevron-down')}</button>
        <div class="sketch-badge" id="sketch-badge" hidden>${icon('pencil-ruler')}<span></span></div>
        ${button('toggle-inspector', 'panel-right-open', 'Показать свойства', { className: 'floating-icon reveal-inspector' })}
      </div>
      <div class="orientation" id="orientation" aria-label="Ориентация модели">
        <div class="orientation-cube" id="orientation-cube">
          ${[['front', 'ПЕРЕД'], ['right', 'ПРАВО'], ['top', 'ВЕРХ'], ['back', 'ТЫЛ'], ['left', 'ЛЕВО'], ['bottom', 'НИЗ']].map(([value, label]) =>
            `<button type="button" class="cube-face ${value}" data-action="orientation" data-value="${value}">${label}</button>`).join('')}
        </div>
        <button class="cube-reset" type="button" data-action="orientation" data-value="iso" title="Изометрия">ISO</button>
      </div>
      <div class="axis-widget" id="axis-widget" aria-hidden="true">
        ${['X', 'Y', 'Z'].map((axis) => `<span class="axis axis-${axis.toLowerCase()}"><i></i><b>${axis}</b></span>`).join('')}
        <span class="axis-origin"></span>
      </div>
      <div class="stage-message" id="stage-message" hidden></div>
      <div class="canvas-tools" id="canvas-tools" aria-label="Управление видом"></div>
    </section>
    <aside class="panel inspector" id="inspector">
      <div class="panel-header"><h2 id="inspector-title">Свойства</h2>
        ${button('toggle-inspector', 'panel-right-close', 'Скрыть свойства', { className: 'icon-button quiet' })}</div>
      <div class="panel-scroll inspector-content" id="inspector-content"></div>
    </aside>
  </main>
  <footer class="statusbar">
    <div class="status-ready" id="status-ready"><i></i><span>Загрузка геометрии</span></div>
    <div class="status-hint" id="status-hint"></div>
    <div class="status-meta"><span id="coordinates" hidden></span><span>${icon('ruler')} Миллиметры</span><span>ММГС</span></div>
  </footer>
  <div id="popup" class="popup" role="menu" hidden></div>
  <dialog id="dialog"></dialog>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <input type="file" id="open-file" accept=".rnx,.json" hidden>`;
}
