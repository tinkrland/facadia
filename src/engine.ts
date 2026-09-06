// svgery core — engine assembly. pure modules, injectable hash.
// the llm may draft ops; only this engine executes them.

import type { Graph } from './graph/types';
import { canonical } from './graph/graph';
import type { Checked, EditOp, Effect } from './ops/defs';
import { check } from './check/checker';
import { applyEffects } from './apply/applier';
import { dofReport } from './check/dof';
import { sha256Hex } from './util/sha256';
import type { LogEntry } from './log/log';

export interface EditOutcome {
  graph: Graph;
  effects: Effect[];
  entry: Omit<LogEntry, 'seq'>;
}

export interface Engine {
  checksum(g: Graph): string;
  check(g: Graph, op: EditOp): Checked;
  applyEffects(g: Graph, effects: Effect[]): Graph;
  edit(g: Graph, op: EditOp, opts?: { actor?: string; ts?: number }): EditOutcome;
  replay(genesis: Graph, log: LogEntry[]): { graph: Graph; failures: string[] };
  dofReport(g: Graph): ReturnType<typeof dofReport>;
}

export function createEngine(hash: (s: string) => string = sha256Hex): Engine {
  const checksum = (g: Graph) => hash(canonical(g));

  return {
    checksum,
    check,
    applyEffects,
    edit(g, op, opts) {
      const res = check(g, op);
      if (!res.ok) throw new Error(res.reason);
      const pre = checksum(g);
      const graph = applyEffects(g, res.effects);
      const post = checksum(graph);
      return {
        graph,
        effects: res.effects,
        entry: {
          op: op.op,
          target: op.target ?? null,
          params: op.params ?? {},
          actor: opts?.actor ?? 'human',
          pre,
          post,
          ts: opts?.ts ?? 0,
        },
      };
    },
    replay(genesis, log) {
      let g = genesis;
      const failures: string[] = [];
      for (const e of log) {
        const pre = checksum(g);
        if (pre !== e.pre) {
          failures.push(`seq ${e.seq}: pre mismatch (${pre} != ${e.pre})`);
          break;
        }
        const res = check(g, { op: e.op, target: e.target ?? undefined, params: e.params });
        if (!res.ok) {
          failures.push(`seq ${e.seq}: ${e.op} rejected: ${res.reason}`);
          break;
        }
        g = applyEffects(g, res.effects);
        const post = checksum(g);
        if (post !== e.post) {
          failures.push(`seq ${e.seq}: post mismatch (${post} != ${e.post})`);
          break;
        }
      }
      return { graph: g, failures };
    },
    dofReport,
  };
}
