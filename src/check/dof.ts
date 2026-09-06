// svgery core — dof accounting (borrowed from cad: every constraint consumes
// degrees of freedom; the report says which frame parameters of each live node
// are pinned and by which constraint).

import type { Graph } from '../graph/types';
import { globMatch, liveNodes } from '../graph/graph';

export interface DofEntry {
  free: string[];
  consumed: Record<string, string>; // param → consuming constraint
}

export type DofReport = Record<string, DofEntry>;

export function dofReport(g: Graph): DofReport {
  const report: DofReport = {};
  for (const node of liveNodes(g)) {
    const consumed: Record<string, string> = {};
    for (const c of Object.values(g.constraints)) {
      if (c.type === 'joint' && (c.a === node.id || c.b === node.id)) {
        // 'fixed' pins a param; 'insert' means it may slide — still mobile dof
        if (c.dof.x === 'fixed') consumed.x = `joint:${c.id}`;
        if (c.dof.y === 'fixed') consumed.y = `joint:${c.id}`;
      }
      if (c.type === 'ratio') {
        for (const ref of [c.numerator, c.denominator]) {
          if (ref.node && ref.prop && globMatch(ref.node, node.id)) {
            consumed[ref.prop.slice('frame.'.length)] = `ratio:${c.id}`;
          }
        }
      }
    }
    const all = ['x', 'y', 'w', 'h'];
    report[node.id] = { free: all.filter((p) => !(p in consumed)), consumed };
  }
  return report;
}
