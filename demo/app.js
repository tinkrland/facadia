// svgery demo — the kallax shelf as a thin consumer of the core engine.
// every visible change is an edit op: checked, applied, logged, patched.

import { createEngine, createGraph, addNode, addConstraint, sceneBBox } from '../dist/index.js';
import { renderPatch, renderSvgString } from '../dist/index.js';
import { applyPatch } from '../dist/index.js';

const engine = createEngine();

// hand-authored shelf (same fixture as the test suite)
let g = createGraph({
  id: 'shelf-01',
  views: [
    { name: 'front', projection: 'orthographic', camera: { az: 0, el: 0 } },
    { name: 'side', projection: 'orthographic', camera: { az: 90, el: 0 } },
    { name: 'top', projection: 'orthographic', camera: { az: 0, el: 90 } },
    { name: 'iso', projection: 'axonometric', camera: { az: 45, el: 35.264 } },
  ],
});
g = addNode(g, { id: 'shelf', role: 'carcass', parent: null, frame: { x: 0, y: 0, w: 772, h: 772 }, attrs: { fill: '#f5f0e6', depth: 390 } });
g = addNode(g, { id: 'shelf.back', role: 'panel', parent: 'shelf', frame: { x: 8, y: 8, w: 756, h: 756 }, attrs: { fill: '#e8e2d6' } });
for (let i = 0; i < 4; i++) {
  g = addNode(g, { id: `shelf.tier.${i + 1}`, role: 'tier', parent: 'shelf', frame: { x: 0, y: i * 193, w: 772, h: 193 }, attrs: { fill: '#f5f0e6' } });
}
g = addConstraint(g, { id: 'wl-shelf', type: 'whitelist', node: 'shelf', ops: {
  insert_tier: { min: 1, max: 8, at: ['top', 'bottom'], respacing: 'even' },
  remove_tier: { min: 1 },
  stretch: { axes: ['w', 'h'] },
  recolor: { any: true },
  rotate: { any: true },
} });
g = addConstraint(g, { id: 'ratio-tier', type: 'ratio', numerator: { node: 'shelf.tier.*', prop: 'frame.h' }, denominator: { node: 'shelf', prop: 'frame.h' }, range: [0.12, 0.26] });

const svg = document.getElementById('scene');
const menu = document.getElementById('menu');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const log = [];

const palette = ['#f5f0e6', '#c96f4a', '#4a7ba6', '#5c8a5c', '#8a5c8a', '#d9b64a'];
let colorIdx = 0;

function fitViewbox() {
  const bb = sceneBBox(g);
  svg.setAttribute('viewBox', `${bb.minX} ${bb.minY} ${bb.w} ${bb.h}`);
}

function paintInitial() {
  fitViewbox();
  svg.innerHTML = renderSvgString(g);
  syncPanel(null);
}

function syncPanel(patch) {
  document.getElementById('view').textContent = `view: ${g.currentView}`;
  document.getElementById('ops').textContent = `ops: ${log.length}`;
  document.getElementById('checksum').textContent = engine.checksum(g).slice(0, 32) + '…';
  document.getElementById('patch').textContent = patch
    ? `last edit: ${patch.adds.length} add · ${patch.updates.length} update · ${patch.removes.length} remove${patch.adds.length + patch.updates.length + patch.removes.length <= 2 ? ' — surgical' : ''}`
    : 'last edit: —';
  statusEl.textContent = '';
  logEl.innerHTML = '';
  for (const e of [...log].slice(-8).reverse()) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${e.op}</b>${e.target ? ` → ${e.target}` : ''} <br><span style="opacity:.5">${e.pre.slice(0, 8)}…→${e.post.slice(0, 8)}…</span>`;
    logEl.appendChild(li);
  }
}

function doEdit(op) {
  try {
    const out = engine.edit(g, op, { actor: 'demo', ts: Date.now() });
    const patch = renderPatch(g, out.graph);
    g = out.graph;
    applyPatch(svg, patch);
    if (op.op === 'swap_view') fitViewbox();
    log.push(out.entry);
    syncPanel(patch);
  } catch (err) {
    statusEl.textContent = `✋ ${err.message}`; // constraints enforced, visibly
  } finally {
    menu.style.display = 'none';
  }
}

const items = [
  { label: 'insert tier (top)', run: () => doEdit({ op: 'insert_tier', target: 'shelf', params: { at: 'top' } }) },
  { label: 'insert tier (bottom)', run: () => doEdit({ op: 'insert_tier', target: 'shelf', params: { at: 'bottom' } }) },
  { label: 'remove tier (top)', run: () => doEdit({ op: 'remove_tier', target: 'shelf', params: { at: 'top' } }) },
  { label: 'remove tier (bottom)', run: () => doEdit({ op: 'remove_tier', target: 'shelf', params: { at: 'bottom' } }) },
  { label: 'stretch taller', run: () => doEdit({ op: 'stretch', target: 'shelf', params: { axis: 'h', factor: 1.1 } }) },
  { label: 'stretch shorter', run: () => doEdit({ op: 'stretch', target: 'shelf', params: { axis: 'h', factor: 1 / 1.1 } }) },
  { label: 'stretch wider', run: () => doEdit({ op: 'stretch', target: 'shelf', params: { axis: 'w', factor: 1.1 } }) },
  { label: 'recolor carcass', run: () => doEdit({ op: 'recolor', target: 'shelf', params: { fill: palette[++colorIdx % palette.length] } }) },
  { label: 'rotate 90°', run: () => doEdit({ op: 'rotate', target: 'shelf', params: { deg: 90 } }) },
  { sep: true },
  ...['front', 'side', 'top', 'iso'].map((v) => ({
    label: `view: ${v}`,
    view: v,
    run: () => doEdit({ op: 'swap_view', params: { view: v } }),
  })),
];

function buildMenu() {
  menu.innerHTML = '';
  for (const it of items) {
    if (it.sep) { menu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.view) {
      b.classList.add('view');
      if (g.currentView === it.view) b.classList.add('current');
    }
    b.addEventListener('click', it.run);
    menu.appendChild(b);
  }
}

svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  buildMenu();
  menu.style.display = 'block';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 380)}px`;
});

window.addEventListener('click', () => { menu.style.display = 'none'; });
menu.addEventListener('click', (e) => e.stopPropagation());

paintInitial();
