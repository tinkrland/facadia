// svgery core — dom host. applies a patch to a real <svg> with minimal
// element surgery: adds create elements, updates rewrite attrs, removes drop
// elements, order re-appends. browser-only; guarded so node imports stay safe.

import type { DomPatch } from './adapter';

export function applyPatch(svg: SVGSVGElement, patch: DomPatch): { touched: number } {
  if (typeof document === 'undefined') throw new Error('applyPatch needs a browser DOM');
  const NS = 'http://www.w3.org/2000/svg';
  let touched = 0;

  for (const id of patch.removes) {
    const el = svg.querySelector(`[data-node-id="${id}"]`);
    if (el) {
      el.remove();
      touched += 1;
    }
  }
  for (const add of patch.adds) {
    const el = document.createElementNS(NS, add.tag);
    for (const [k, v] of Object.entries(add.attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
    touched += 1;
  }
  for (const upd of patch.updates) {
    const el = svg.querySelector(`[data-node-id="${upd.nodeId}"]`);
    if (!el) continue;
    for (const [k, v] of Object.entries(upd.attrs)) el.setAttribute(k, v);
    touched += 1;
  }
  // repaint order: re-append in far→near sequence (append moves the node)
  for (const id of patch.order) {
    const el = svg.querySelector(`[data-node-id="${id}"]`);
    if (el) svg.appendChild(el);
  }
  return { touched };
}
