// svgery core — the op log. provenance: every applied op is logged with
// pre/post checksums. replay of the log must reproduce the graph exactly,
// which makes the log both provenance and the regression suite.

import type { Graph } from '../graph/types';

export interface LogEntry {
  seq: number;
  op: string;
  target: string | null;
  params: Record<string, unknown>;
  actor: string;
  pre: string; // sha256 of canonical graph before the op
  post: string; // sha256 of canonical graph after the op
  ts: number; // wall clock — kept OUT of graph checksums, lives only here
}

export function appendLog(log: LogEntry[], entry: Omit<LogEntry, 'seq'>): LogEntry[] {
  return [...log, { ...entry, seq: log.length }];
}
