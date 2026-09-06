// svgery core — engine tests. the kallax-style shelf is the first consumer,
// not the codebase: the engine is exercised through pure graph ops.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Graph, JointConstraint, RatioConstraint, WhitelistConstraint } from '../src/graph/types';
import { addConstraint, addNode, canonical, createGraph, getNode, liveChildren } from '../src/graph/graph';
import { createEngine } from '../src/engine';
import type { EditOp, LogEntry } from '../src/index';
import { sha256Hex } from '../src/util/sha256';

const engine = createEngine();

function shelfFixture(
  opts: { tiers?: number; ratio?: [number, number]; max?: number; min?: number } = {}
): Graph {
  const tiers = opts.tiers ?? 4;
  const range = opts.ratio ?? [0.12, 0.26];
  let g = createGraph({
    id: 'shelf-01',
    views: [
      { name: 'front', projection: 'orthographic', camera: { az: 0, el: 0 } },
      { name: 'side', projection: 'orthographic', camera: { az: 90, el: 0 } },
      { name: 'top', projection: 'orthographic', camera: { az: 0, el: 90 } },
      { name: 'iso', projection: 'axonometric', camera: { az: 45, el: 35.264 } },
    ],
  });
  const H = 772;
  g = addNode(g, { id: 'shelf', role: 'carcass', parent: null, frame: { x: 0, y: 0, w: 772, h: H }, attrs: { fill: '#f5f0e6' } });
  g = addNode(g, { id: 'shelf.back', role: 'panel', parent: 'shelf', frame: { x: 8, y: 8, w: 756, h: 756 }, attrs: { fill: '#e8e2d6' } });
  const th = H / tiers;
  for (let i = 0; i < tiers; i++) {
    g = addNode(g, {
      id: `shelf.tier.${i + 1}`,
      role: 'tier',
      parent: 'shelf',
      frame: { x: 0, y: i * th, w: 772, h: th },
      attrs: { fill: '#f5f0e6' },
    });
  }
  g = addConstraint(g, {
    id: 'wl-shelf',
    type: 'whitelist',
    node: 'shelf',
    ops: {
      insert_tier: { min: 1, max: opts.max ?? 8, at: ['top', 'bottom'], respacing: 'even' },
      remove_tier: { min: opts.min ?? 1 },
      stretch: { axes: ['w', 'h'] },
      recolor: { any: true },
      rotate: { any: true },
    },
  } as WhitelistConstraint);
  g = addConstraint(g, {
    id: 'ratio-tier',
    type: 'ratio',
    numerator: { node: 'shelf.tier.*', prop: 'frame.h' },
    denominator: { node: 'shelf', prop: 'frame.h' },
    range,
  } as RatioConstraint);
  g = addConstraint(g, {
    id: 'joint-1',
    type: 'joint',
    a: 'shelf',
    b: 'shelf.tier.1',
    joint: 'dado',
    anchor: { from: 'bottom', to: 'inner-top' },
    dof: { x: 'fixed', y: 'insert', z: 'fixed' },
  } as JointConstraint);
  return g;
}

describe('invariant 1: ids are addresses, never renumbered, never reused', () => {
  it('insert_tier keeps all existing tier ids and adds a fresh one', () => {
    const g = shelfFixture();
    const out = engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 1, at: 'top' } });
    const ids = liveChildren(out.graph, 'shelf', 'tier').map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['shelf.tier.1', 'shelf.tier.2', 'shelf.tier.3', 'shelf.tier.4']));
    expect(ids.length).toBe(5);
    const fresh = ids.find((id) => !['shelf.tier.1', 'shelf.tier.2', 'shelf.tier.3', 'shelf.tier.4'].includes(id));
    expect(fresh).toMatch(/^shelf\.tier\.\d+$/); // fresh counter id — never a renumbered one
    for (const t of liveChildren(out.graph, 'shelf', 'tier')) {
      expect(t.frame.h).toBeCloseTo(772 / 5, 6);
    }
  });

  it('insert count: 2 respaces evenly across six tiers', () => {
    const g = shelfFixture();
    const out = engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 2, at: 'top' } });
    const tiers = liveChildren(out.graph, 'shelf', 'tier');
    expect(tiers.length).toBe(6);
    for (const t of tiers) expect(Math.abs(t.frame.h - 772 / 6)).toBeLessThan(1e-9);
  });

  it('tombstoned ids are never reused', () => {
    let g = shelfFixture({ tiers: 5, ratio: [0.12, 0.4] }); // ratio permits 4 tiers after removal
    g = engine.edit(g, { op: 'remove_tier', target: 'shelf', params: { at: 'top' } }).graph;
    const dead = 'shelf.tier.5';
    expect(getNode(g, dead).deleted).toBe(true);
    const out = engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 1, at: 'top' } });
    const live = liveChildren(out.graph, 'shelf', 'tier').map((t) => t.id);
    expect(live).not.toContain(dead);
    expect(getNode(out.graph, dead).deleted).toBe(true); // tombstone survives
  });

  it('insert rejects beyond whitelist max', () => {
    const g = shelfFixture();
    expect(() => engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 5 } })).toThrow(/exceeds whitelist max 8/);
    const ok = engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 4 } });
    expect(liveChildren(ok.graph, 'shelf', 'tier').length).toBe(8);
  });

  it('remove_tier respects whitelist min', () => {
    const g = shelfFixture({ min: 4 });
    expect(() => engine.edit(g, { op: 'remove_tier', target: 'shelf', params: { at: 'top' } })).toThrow(/below whitelist min 4/);
  });
});

describe('invariant 2: every state change is a whitelisted, constraint-checked op', () => {
  it('a lamp may not grow a drawer: ops must be whitelisted', () => {
    const g = shelfFixture();
    const res = engine.check(g, { op: 'insert_tier', target: 'shelf.back' });
    expect(res.ok).toBe(false); // panel has no tier template and no insert whitelist of its own
    if (!res.ok) expect(res.reason).toMatch(/not whitelisted|no live tier/);
  });

  it('ratio locks reject out-of-range respacing', () => {
    const g = shelfFixture({ tiers: 6, ratio: [0.15, 0.26] });
    // 6 tiers: 1/6 ≈ 0.167 ok; inserting one → 1/7 ≈ 0.143 < 0.15 → reject
    expect(() => engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 1 } })).toThrow(/ratio-tier/);
  });

  it('stretch consults ratio locks on the target itself', () => {
    let g = shelfFixture();
    g = addConstraint(g, {
      id: 'ratio-aspect',
      type: 'ratio',
      numerator: { node: 'shelf', prop: 'frame.w' },
      denominator: { node: 'shelf', prop: 'frame.h' },
      range: [0.8, 1.2],
    } as RatioConstraint);
    expect(() => engine.edit(g, { op: 'stretch', target: 'shelf', params: { axis: 'w', factor: 3 } })).toThrow(/ratio-aspect/);
    const out = engine.edit(g, { op: 'stretch', target: 'shelf', params: { axis: 'h', factor: 1.1 } });
    expect(getNode(out.graph, 'shelf').frame.h).toBeCloseTo(772 * 1.1, 6);
    for (const t of liveChildren(out.graph, 'shelf', 'tier')) {
      expect(t.frame.h).toBeCloseTo((772 * 1.1) / 4, 6);
    }
  });

  it('insert at an unwhitelisted position is rejected', () => {
    const g = shelfFixture();
    expect(() => engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { at: 'middle' } })).toThrow(/not allowed/);
  });

  it('recolor keeps identity, rotate composes, swap_view validates', () => {
    let g = shelfFixture();
    g = engine.edit(g, { op: 'recolor', target: 'shelf.tier.2', params: { fill: '#111111' } }).graph;
    expect(getNode(g, 'shelf.tier.2').attrs.fill).toBe('#111111');
    g = engine.edit(g, { op: 'rotate', target: 'shelf', params: { deg: 90 } }).graph;
    expect(getNode(g, 'shelf').frame.rotation).toBe(90);
    g = engine.edit(g, { op: 'rotate', target: 'shelf', params: { deg: -180 } }).graph;
    expect(getNode(g, 'shelf').frame.rotation).toBe(270);
    g = engine.edit(g, { op: 'swap_view', params: { view: 'iso' } }).graph;
    expect(g.currentView).toBe('iso');
    expect(() => engine.edit(g, { op: 'swap_view', params: { view: 'free-camera' } })).toThrow(/unknown view/);
  });
});

describe('invariant 3: the engine is pure — no mutation, no redraw', () => {
  it('checker and edit never mutate the input graph', () => {
    const g = shelfFixture();
    const before = canonical(g);
    engine.check(g, { op: 'insert_tier', target: 'shelf', params: { count: 1 } });
    const res = engine.check(g, { op: 'insert_tier', target: 'shelf.back' });
    expect(res.ok).toBe(false);
    engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 1 } });
    expect(canonical(g)).toBe(before);
  });
});

describe('provenance: the op log replays exactly', () => {
  it('replay of the log reproduces the final graph checksum', () => {
    const genesis = shelfFixture();
    let g = genesis;
    const log: LogEntry[] = [];
    const ops: EditOp[] = [
      { op: 'insert_tier', target: 'shelf', params: { count: 1, at: 'top' } },
      { op: 'recolor', target: 'shelf.tier.2', params: { fill: '#111111' } },
      { op: 'stretch', target: 'shelf', params: { axis: 'h', factor: 1.1 } },
      { op: 'rotate', target: 'shelf', params: { deg: 90 } },
      { op: 'swap_view', params: { view: 'iso' } },
      { op: 'remove_tier', target: 'shelf', params: { at: 'bottom' } },
    ];
    for (const [i, o] of ops.entries()) {
      const out = engine.edit(g, o, { actor: 'test', ts: i });
      g = out.graph;
      log.push({ ...out.entry, seq: log.length });
    }
    const final = engine.checksum(g);
    const r = engine.replay(genesis, log);
    expect(r.failures).toEqual([]);
    expect(engine.checksum(r.graph)).toBe(final);
  });

  it('tampering with the log is detected', () => {
    const genesis = shelfFixture();
    const out = engine.edit(genesis, { op: 'recolor', target: 'shelf.tier.1', params: { fill: '#000000' } });
    const log: LogEntry[] = [{ ...out.entry, seq: 0 }];
    log[0].post = log[0].post.slice(0, -1) + '0'; // corrupt the post checksum
    const r = engine.replay(genesis, log);
    expect(r.failures.length).toBeGreaterThan(0);
  });
});

describe('dof accounting', () => {
  it('joints and ratio locks consume the right parameters', () => {
    const g = shelfFixture();
    const report = engine.dofReport(g);
    const t1 = report['shelf.tier.1'];
    expect(t1.consumed.x).toBe('joint:joint-1'); // joint pins x
    expect(t1.consumed.h).toBe('ratio:ratio-tier'); // ratio lock pins h
    expect(t1.free).toContain('y'); // 'insert' dof — may slide
    expect(t1.free).toContain('w');
  });
});

describe('pure sha256 (browser-grade, cross-checked)', () => {
  it('matches node:crypto on a spread of inputs', () => {
    for (const s of ['', 'abc', 'hello svgery', 'a'.repeat(1000), canonical(shelfFixture())]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});
