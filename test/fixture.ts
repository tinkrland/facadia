// shared test fixture: the kallax-style shelf, hand-authored

import type { Graph, JointConstraint, RatioConstraint, WhitelistConstraint } from '../src/graph/types';
import { addConstraint, addNode, createGraph } from '../src/graph/graph';

export function shelfFixture(
  opts: { tiers?: number; ratio?: [number, number]; max?: number; min?: number; depth?: number } = {}
): Graph {
  const tiers = opts.tiers ?? 4;
  const range = opts.ratio ?? [0.12, 0.26];
  const depth = opts.depth ?? 390;
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
  g = addNode(g, {
    id: 'shelf',
    role: 'carcass',
    parent: null,
    frame: { x: 0, y: 0, w: 772, h: H },
    attrs: { fill: '#f5f0e6', depth },
  });
  g = addNode(g, {
    id: 'shelf.back',
    role: 'panel',
    parent: 'shelf',
    frame: { x: 8, y: 8, w: 756, h: 756 },
    attrs: { fill: '#e8e2d6' },
  });
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
