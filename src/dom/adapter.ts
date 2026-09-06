// svgery core — the keyed svg adapter. the only module that thinks about
// elements. node id → element, per view; edits produce minimal patches,
// react-style reconciliation keyed by stable node ids. an edit that touches
// one tier patches one element. a view turn patches zero adds and zero
// removes — that is the falsifier made mechanical.

import type { Graph } from '../graph/types';
import { canonical } from '../graph/graph';
import { shapesForView } from '../views/views';

export interface ShapeAdd {
  nodeId: string;
  tag: string;
  attrs: Record<string, string>;
}

export interface DomPatch {
  adds: ShapeAdd[];
  removes: string[];
  updates: ShapeAdd[];
  order: string[]; // paint order: far → near, parents before children
}

function attrsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function renderPatch(prev: Graph, next: Graph): DomPatch {
  const prevItems = shapesForView(prev);
  const nextItems = shapesForView(next);
  const prevShapes = new Map(prevItems.map((s) => [s.nodeId, s.shape.attrs]));
  const nextShapes = new Map(nextItems.map((s) => [s.nodeId, s.shape.attrs]));

  const removes: string[] = [];
  for (const id of prevShapes.keys()) if (!nextShapes.has(id)) removes.push(id);

  const adds: ShapeAdd[] = [];
  const updates: ShapeAdd[] = [];
  for (const [id, attrs] of nextShapes) {
    const before = prevShapes.get(id);
    if (before === undefined) adds.push({ nodeId: id, tag: 'polygon', attrs });
    else if (!attrsEqual(attrs, before)) updates.push({ nodeId: id, tag: 'polygon', attrs });
  }

  return { adds, removes, updates, order: nextItems.map((s) => s.nodeId) };
}

// debug/demo helper: the whole scene as svg polygon markup
export function renderSvgString(g: Graph): string {
  return shapesForView(g)
    .map(
      (s) =>
        `<polygon ${Object.entries(s.shape.attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')} />`
    )
    .join('\n');
}

// purity guard used by tests: rendering must never rewrite the graph it reads
export function assertRenderPurity(g: Graph, render: (x: Graph) => unknown): void {
  const before = canonical(g);
  render(g);
  if (canonical(g) !== before) throw new Error('rendering mutated the graph — redraw in a trench coat');
}
