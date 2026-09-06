// svgery core — views. a view is a projection of the graph, never an
// independent drawing. boxy furniture is extruded 2D profiles: the frame is
// the front face, the depth attr extrudes it, and every view — front, side,
// top, iso — is the same axonometric camera at different az/el. orthographic
// views are just camera presets (front 0/0, side 90/0, top 0/90).

import type { Graph, GraphNode, ViewDef } from '../graph/types';
import { liveNodes } from '../graph/graph';

export interface Point {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  dx: number;
  dy: number;
  dz: number;
  rot: number; // degrees about the vertical (y) axis
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// child frames live in parent space: apply child rotation, rotate the child
// translation into the parent frame, add the parent translation.
export function compose(parent: Transform, child: Transform): Transform {
  const r = rad(parent.rot);
  return {
    dx: parent.dx + child.dx * Math.cos(r) + child.dz * Math.sin(r),
    dy: parent.dy + child.dy,
    dz: parent.dz - child.dx * Math.sin(r) + child.dz * Math.cos(r),
    rot: parent.rot + child.rot,
  };
}

export function applyT(t: Transform, p: Vec3): Vec3 {
  const r = rad(t.rot);
  return {
    x: t.dx + p.x * Math.cos(r) + p.z * Math.sin(r),
    y: t.dy + p.y,
    z: t.dz - p.x * Math.sin(r) + p.z * Math.cos(r),
  };
}

function chainOf(g: Graph, node: GraphNode): GraphNode[] {
  const chain: GraphNode[] = [];
  let cur: GraphNode | undefined = node;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? g.nodes[cur.parent] : undefined;
  }
  return chain;
}

// depth inheritance: children fill their ancestor's extrusion unless they
// declare their own. a real object declares depth on its carcass.
function resolveDepth(g: Graph, node: GraphNode): number {
  let cur: GraphNode | undefined = node;
  while (cur) {
    const d = cur.attrs.depth;
    if (typeof d === 'number' && d > 0) return d;
    cur = cur.parent ? g.nodes[cur.parent] : undefined;
  }
  return 100;
}

// the world-space box of a node: front face from the (accumulated) frame,
// extruded by depth. local frames compose through the parent chain —
// stretching a parent recalculates children by transform, not by rewriting.
export function worldBox(g: Graph, node: GraphNode): { corners: Vec3[]; depth: number } {
  let t: Transform = { dx: 0, dy: 0, dz: 0, rot: 0 };
  for (const n of chainOf(g, node)) {
    t = compose(t, {
      dx: n.frame.x,
      dy: n.frame.y,
      dz: typeof n.attrs.z === 'number' ? n.attrs.z : 0,
      rot: n.frame.rotation ?? 0,
    });
  }
  const { w, h } = node.frame;
  const d = resolveDepth(g, node);
  const local: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: w, y: 0, z: 0 },
    { x: w, y: h, z: 0 },
    { x: 0, y: h, z: 0 },
    { x: 0, y: 0, z: d },
    { x: w, y: 0, z: d },
    { x: w, y: h, z: d },
    { x: 0, y: h, z: d },
  ];
  return { corners: local.map((p) => applyT(t, p)), depth: d };
}

// the one camera: rotate about y by az, tilt by el, drop the depth axis.
// svg y is down, so screen y is negated on the way out.
export function projectPoint(p: Vec3, az: number, el: number): { screen: Point; depth: number } {
  const a = rad(az);
  const e = rad(el);
  const x1 = p.x * Math.cos(a) + p.z * Math.sin(a);
  const z1 = -p.x * Math.sin(a) + p.z * Math.cos(a);
  const y2 = p.y * Math.cos(e) - z1 * Math.sin(e);
  const z2 = p.y * Math.sin(e) + z1 * Math.cos(e);
  return { screen: { x: x1, y: -y2 }, depth: z2 };
}

// convex hull (monotone chain) — the silhouette of a projected box
export function hull(points: Point[]): Point[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function getView(g: Graph, name?: string | null): ViewDef {
  const v = g.views.find((x) => x.name === (name ?? g.currentView)) ?? g.views[0];
  if (!v) throw new Error(`graph ${g.id} has no views`);
  return v;
}

export interface Projected {
  points: Point[]; // hull of the silhouette, svg coords (y down)
  depth: number; // painter key: ascending = far to near
}

export function projectNode(g: Graph, node: GraphNode, view: ViewDef): Projected {
  const { corners } = worldBox(g, node);
  const screens: Point[] = [];
  let dsum = 0;
  for (const c of corners) {
    const { screen, depth } = projectPoint(c, view.camera.az, view.camera.el);
    screens.push(screen);
    dsum += depth;
  }
  return { points: hull(screens), depth: dsum / corners.length };
}

export interface Shape {
  tag: 'polygon';
  points: Point[];
  attrs: Record<string, string>;
  depth: number;
  treeDepth: number;
}

// all live nodes, paint-ordered for the current view: far before near,
// parents before children on depth ties, ids as the final tiebreak.
export function shapesForView(g: Graph): { nodeId: string; shape: Shape }[] {
  const view = getView(g);
  const out: { nodeId: string; shape: Shape }[] = [];
  for (const node of liveNodes(g)) {
    const { points, depth } = projectNode(g, node, view);
    out.push({
      nodeId: node.id,
      shape: {
        tag: 'polygon',
        points,
        depth,
        treeDepth: chainOf(g, node).length,
        attrs: {
          points: points.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' '),
          fill: String(node.attrs.fill ?? '#cccccc'),
          'data-node-id': node.id,
        },
      },
    });
  }
  out.sort(
    (a, b) =>
      a.shape.depth - b.shape.depth ||
      a.shape.treeDepth - b.shape.treeDepth ||
      (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)
  );
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sceneBBox(g: Graph): { minX: number; minY: number; w: number; h: number } {
  const items = shapesForView(g);
  if (items.length === 0) return { minX: 0, minY: 0, w: 100, h: 100 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { shape } of items) {
    for (const p of shape.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 30;
  return { minX: minX - pad, minY: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
