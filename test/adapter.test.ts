// the keyed svg adapter — minimality is the test. an edit that touches one
// node patches one element. a view turn patches zero adds and zero removes.

import { describe, expect, it } from 'vitest';
import { createGraph, liveNodes, canonical } from '../src/graph/graph';
import { createEngine } from '../src/engine';
import { renderPatch, renderSvgString, assertRenderPurity } from '../src/dom/adapter';
import { shapesForView } from '../src/views/views';
import { shelfFixture } from './fixture';

const engine = createEngine();

function emptyLike(g: ReturnType<typeof shelfFixture>) {
  return { ...createGraph({ id: g.id, views: g.views }), currentView: g.currentView };
}

describe('keyed reconciliation: edits are surgical', () => {
  it('initial render adds every live node, once', () => {
    const g = shelfFixture();
    const patch = renderPatch(emptyLike(g), g);
    expect(patch.adds.length).toBe(liveNodes(g).length);
    expect(patch.removes.length).toBe(0);
    expect(patch.updates.length).toBe(0);
    expect(patch.order.length).toBe(liveNodes(g).length);
  });

  it('recolor patches exactly one element', () => {
    const g = shelfFixture();
    const out = engine.edit(g, { op: 'recolor', target: 'shelf.tier.2', params: { fill: '#111111' } });
    const patch = renderPatch(g, out.graph);
    expect(patch.adds.length).toBe(0);
    expect(patch.removes.length).toBe(0);
    expect(patch.updates.length).toBe(1);
    expect(patch.updates[0].nodeId).toBe('shelf.tier.2');
  });

  it('insert_tier patches one add plus the respaced tiers — never a redraw', () => {
    const g = shelfFixture();
    const out = engine.edit(g, { op: 'insert_tier', target: 'shelf', params: { count: 1, at: 'top' } });
    const patch = renderPatch(g, out.graph);
    expect(patch.adds.length).toBe(1); // the new tier
    expect(patch.removes.length).toBe(0);
    expect(patch.updates.length).toBe(4); // respaced tiers; carcass and back panel untouched
    const untouched = patch.order.filter((id) => !patch.adds.some((a) => a.nodeId === id) && !patch.updates.some((u) => u.nodeId === id));
    expect(untouched.sort()).toEqual(['shelf', 'shelf.back']);
  });

  it('remove_tier removes exactly one element and respaces the rest', () => {
    const g = shelfFixture({ tiers: 5, ratio: [0.12, 0.4] });
    const out = engine.edit(g, { op: 'remove_tier', target: 'shelf', params: { at: 'top' } });
    const patch = renderPatch(g, out.graph);
    expect(patch.removes).toEqual(['shelf.tier.5']);
    expect(patch.adds.length).toBe(0);
    expect(patch.updates.length).toBe(4);
    expect(patch.order).not.toContain('shelf.tier.5');
  });
});

describe('the falsifier, made mechanical: views are projections', () => {
  it('swap_view reuses every element — zero adds, zero removes', () => {
    const g = shelfFixture();
    const out = engine.edit(g, { op: 'swap_view', params: { view: 'iso' } });
    const patch = renderPatch(g, out.graph);
    expect(patch.adds.length).toBe(0);
    expect(patch.removes.length).toBe(0);
    expect(patch.updates.length).toBe(liveNodes(g).length); // same nodes, new shadows
    expect(patch.order).toEqual(shapesForView(out.graph).map((s) => s.nodeId));
  });

  it('front and iso agree on identity: same node ids, same count', () => {
    const g = shelfFixture();
    const front = shapesForView({ ...g, currentView: 'front' });
    const iso = shapesForView({ ...g, currentView: 'iso' });
    expect(front.map((s) => s.nodeId).sort()).toEqual(iso.map((s) => s.nodeId).sort());
  });
});

describe('rendering is pure', () => {
  it('rendering never mutates the graph (no redraw side-effects)', () => {
    const g = shelfFixture();
    const before = canonical(g);
    assertRenderPurity(g, (x) => shapesForView(x));
    assertRenderPurity(g, (x) => renderSvgString(x));
    assertRenderPurity(g, (x) => renderPatch(x, x));
    expect(canonical(g)).toBe(before);
  });

  it('the svg string contains one polygon per live node, keyed by id', () => {
    const g = shelfFixture();
    const svg = renderSvgString(g);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(liveNodes(g).length);
    for (const n of liveNodes(g)) expect(svg).toContain(`data-node-id="${n.id}"`);
  });
});
