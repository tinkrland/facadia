// svgery core — edit ops and effects, as data (the shape grammar's rules)

import type { Frame, GraphNode, ViewName } from '../graph/types';

export type OpName =
  | 'insert_tier'
  | 'remove_tier'
  | 'stretch'
  | 'recolor'
  | 'rotate'
  | 'swap_view'
  | (string & {}); // extensible: ops are typed data, the checker knows the canonical six

export interface EditOp {
  op: OpName;
  target?: string;
  params?: Record<string, unknown>;
}

export type Effect =
  | { kind: 'clone-node'; from: string; to: string; frame: Frame; overrides?: Partial<GraphNode> }
  | { kind: 'tombstone'; node: string }
  | { kind: 'set-frame'; node: string; frame: Frame }
  | { kind: 'set-attr'; node: string; key: string; value: string | number | boolean }
  | { kind: 'set-view'; view: ViewName };

export interface CheckResult {
  ok: true;
  effects: Effect[];
}

export interface CheckFailure {
  ok: false;
  reason: string;
}

export type Checked = CheckResult | CheckFailure;
