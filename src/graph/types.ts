// svgery core — graph types (per docs/constraint-graph.md)

export type ViewName = string;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number; // degrees, around frame origin
}

export type Role = string; // carcass | panel | tier | joint | handle | custom

export interface GraphNode {
  id: string;      // stable, human-readable, never renumbered, never reused
  role: Role;
  parent: string | null;
  frame: Frame;    // local frame, relative to parent — never absolute coords
  geom?: Partial<Record<ViewName, string>>; // per-view path refs; the node is the identity, the paths are its shadows
  attrs: Record<string, string | number | boolean>;
  deleted?: true; // tombstone — id stays reserved forever
  seq: number;    // creation order (deterministic; NOT identity)
}

export type FrameProp = 'frame.x' | 'frame.y' | 'frame.w' | 'frame.h';

export interface RatioRef {
  node?: string;  // exact id or glob ('shelf.tier.*')
  prop?: FrameProp;
  value?: number; // or a literal
}

export interface RatioConstraint {
  id: string;
  type: 'ratio';
  numerator: RatioRef;
  denominator: RatioRef; // must resolve to exactly one value
  range: [number, number]; // inclusive
}

export interface JointConstraint {
  id: string;
  type: 'joint';
  a: string;
  b: string;
  joint: string; // butt | miter | dado | dowel | ...
  anchor: { from: string; to: string };
  dof: { x: 'fixed' | 'free' | 'insert'; y: 'fixed' | 'free' | 'insert'; z: 'fixed' | 'free' | 'insert' };
}

export interface WhitelistConstraint {
  id: string;
  type: 'whitelist';
  node: string; // exact id or glob — what may happen at all
  ops: Record<string, Record<string, unknown>>;
}

export interface SymmetryConstraint {
  id: string;
  type: 'symmetry';
  axis: 'x' | 'y';
  of: string; // node or glob
}

export type Constraint = RatioConstraint | JointConstraint | WhitelistConstraint | SymmetryConstraint;

export interface ViewDef {
  name: ViewName;
  projection: 'orthographic' | 'axonometric';
  camera: { az: number; el: number };
}

export interface Graph {
  id: string;
  views: ViewDef[];
  currentView: ViewName | null;
  nodes: Record<string, GraphNode>;
  constraints: Record<string, Constraint>;
  idCounter: number; // monotonic; fresh ids never collide with live or dead
}
