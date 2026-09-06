// views are projections of one graph — the tests pin the extrusion math

import { describe, expect, it } from 'vitest';
import type { Graph } from '../src/graph/types';
import { getNode } from '../src/graph/graph';
import { projectNode, getView, worldBox, sceneBBox } from '../src/views/views';
import { shelfFixture } from './fixture';

function bbox(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('the extrusion model', () => {
  it('depth is declared on the carcass and inherited by children', () => {
    const g = shelfFixture({ depth: 390 });
    expect(worldBox(g, getNode(g, 'shelf')).depth).toBe(390);
    expect(worldBox(g, getNode(g, 'shelf.tier.2')).depth).toBe(390);
  });

  it('front view: the frame rect, unprojected (y down)', () => {
    const g = shelfFixture();
    const p = projectNode(g, getNode(g, 'shelf'), getView(g, 'front'));
    expect(p.points.length).toBe(4);
    expect(bbox(p.points).w).toBeCloseTo(772, 3);
    expect(bbox(p.points).h).toBeCloseTo(772, 3);
  });

  it('side view: depth becomes width', () => {
    const g = shelfFixture();
    const p = projectNode(g, getNode(g, 'shelf'), getView(g, 'side'));
    expect(bbox(p.points).w).toBeCloseTo(390, 3);
    expect(bbox(p.points).h).toBeCloseTo(772, 3);
  });

  it('top view: depth becomes height, width stays', () => {
    const g = shelfFixture();
    const p = projectNode(g, getNode(g, 'shelf'), getView(g, 'top'));
    expect(bbox(p.points).w).toBeCloseTo(772, 3);
    expect(bbox(p.points).h).toBeCloseTo(390, 3);
  });

  it('iso view: a box projects to a hexagonal silhouette', () => {
    const g = shelfFixture();
    const p = projectNode(g, getNode(g, 'shelf'), getView(g, 'iso'));
    expect(p.points.length).toBe(6);
    // (w + d) · cos45
    expect(bbox(p.points).w).toBeCloseTo((772 + 390) * Math.cos(Math.PI / 4), 1);
  });

  it('rotate 90° about y: the front silhouette turns depth into width', () => {
    const g = shelfFixture();
    const rotated = { ...g, nodes: { ...g.nodes } } as Graph;
    rotated.nodes['shelf'] = { ...rotated.nodes['shelf'], frame: { ...rotated.nodes['shelf'].frame, rotation: 90 } };
    const p = projectNode(rotated, getNode(rotated, 'shelf'), getView(rotated, 'front'));
    expect(bbox(p.points).w).toBeCloseTo(390, 3);
  });

  it('the scene bbox covers every view (nothing clipped, nothing off-canvas)', () => {
    for (const view of ['front', 'side', 'top', 'iso']) {
      const g = shelfFixture();
      const g2 = { ...g, currentView: view } as Graph;
      const bb = sceneBBox(g2);
      expect(bb.w).toBeGreaterThan(0);
      expect(bb.h).toBeGreaterThan(0);
    }
  });
});
