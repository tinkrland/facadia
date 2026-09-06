// svgery core — the applier. deterministic: (graph, effects) → graph'.
// never touches svg. no randomness, no clocks, no global state.

import type { Graph } from '../graph/types';
import { clone } from '../graph/graph';
import type { Effect } from '../ops/defs';

export function applyEffects(g: Graph, effects: Effect[]): Graph {
  const next = clone(g);
  for (const e of effects) {
    switch (e.kind) {
      case 'clone-node': {
        const template = next.nodes[e.from];
        if (!template) throw new Error(`clone-node: unknown template ${e.from}`);
        if (next.nodes[e.to]) throw new Error(`clone-node: id already exists (never reuse): ${e.to}`);
        const node = clone(template);
        node.id = e.to;
        node.frame = clone(e.frame);
        if (e.overrides) Object.assign(node, e.overrides);
        node.seq = next.idCounter++;
        // keep the id counter ahead of any allocated id so future fresh ids
        // never collide — including with ids the checker reserved in a batch.
        const m = /\.(\d+)$/.exec(e.to);
        if (m) next.idCounter = Math.max(next.idCounter, Number(m[1]) + 1);
        next.nodes[e.to] = node;
        break;
      }
      case 'tombstone': {
        const node = next.nodes[e.node];
        if (!node) throw new Error(`tombstone: unknown node ${e.node}`);
        if (node.deleted) throw new Error(`tombstone: already dead ${e.node}`);
        node.deleted = true; // the id stays reserved forever
        break;
      }
      case 'set-frame': {
        const node = next.nodes[e.node];
        if (!node) throw new Error(`set-frame: unknown node ${e.node}`);
        node.frame = clone(e.frame);
        break;
      }
      case 'set-attr': {
        const node = next.nodes[e.node];
        if (!node) throw new Error(`set-attr: unknown node ${e.node}`);
        node.attrs[e.key] = e.value;
        break;
      }
      case 'set-view': {
        if (!next.views.some((v) => v.name === e.view)) throw new Error(`set-view: unknown view ${e.view}`);
        next.currentView = e.view;
        break;
      }
      default:
        throw new Error(`unknown effect kind: ${JSON.stringify(e)}`);
    }
  }
  return next;
}
