// svgery core — graph store. ids are addresses, not indices.

import type { Constraint, Graph, GraphNode, ViewDef, ViewName } from './types';

// plain byte-wise compare — locale-independent so checksums are machine-independent
export function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function createGraph(opts: { id: string; views: ViewDef[]; currentView?: ViewName | null }): Graph {
  return {
    id: opts.id,
    views: [...opts.views].sort(byName),
    currentView: opts.currentView !== undefined ? opts.currentView : (opts.views[0]?.name ?? null),
    nodes: {},
    constraints: {},
    idCounter: 1,
  };
}

export function addNode(g: Graph, node: Omit<GraphNode, 'seq'>): Graph {
  const next = clone(g);
  if (next.nodes[node.id]) throw new Error(`node id already exists: ${node.id}`);
  next.nodes[node.id] = { ...node, seq: next.idCounter++ } as GraphNode;
  return next;
}

export function addConstraint(g: Graph, c: Constraint): Graph {
  const next = clone(g);
  if (next.constraints[c.id]) throw new Error(`constraint id already exists: ${c.id}`);
  next.constraints[c.id] = c;
  return next;
}

export function getNode(g: Graph, id: string): GraphNode {
  const n = g.nodes[id];
  if (!n) throw new Error(`unknown node: ${id}`);
  return n;
}

export function isLive(n: GraphNode): boolean {
  return !n.deleted;
}

export function globMatch(pattern: string, id: string): boolean {
  if (pattern === id) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2) + '.';
    return id.startsWith(prefix) && id.length > prefix.length;
  }
  return false;
}

export function liveNodes(g: Graph, pattern?: string): GraphNode[] {
  return Object.values(g.nodes)
    .filter((n) => isLive(n) && (!pattern || globMatch(pattern, n.id)))
    .sort(byId);
}

export function liveChildren(g: Graph, parent: string, role?: string): GraphNode[] {
  return liveNodes(g).filter((n) => n.parent === parent && (!role || n.role === role));
}

// fresh ids come from the monotonic counter — they can never collide with live
// nodes OR tombstones, and dead ids are never recycled.
export function freshId(g: Graph, templateId: string, reserved: string[] = []): string {
  const base = templateId.replace(/\.\d+$/, '');
  let n = g.idCounter;
  let id = `${base}.${n}`;
  while (g.nodes[id] || reserved.includes(id)) {
    n += 1;
    id = `${base}.${n}`;
  }
  reserved.push(id);
  return id;
}

// canonical serialization: sorted keys, sorted collections, no volatile fields.
// the checksum input is exactly this string.
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonical(g: Graph): string {
  return JSON.stringify(
    canonicalize({
      id: g.id,
      views: [...g.views].sort(byName),
      currentView: g.currentView,
      nodes: Object.values(g.nodes).sort((a, b) => byId(a, b)),
      constraints: Object.values(g.constraints).sort((a, b) => byId(a, b)),
      idCounter: g.idCounter,
    })
  );
}
