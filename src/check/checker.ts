// svgery core — the checker. pure: (graph, op) → reject | effects.
// an op is admissible iff its whitelist allows it and the affected cluster
// stays solvable — ratio locks validated on the candidate graph, never by vibes.

import type { Frame, Graph, GraphNode, RatioConstraint, RatioRef, WhitelistConstraint } from '../graph/types';
import { freshId, getNode, globMatch, liveChildren, liveNodes } from '../graph/graph';
import type { Checked, EditOp, Effect } from '../ops/defs';
import { applyEffects } from '../apply/applier';

const EPS = 1e-9;

export function check(g: Graph, op: EditOp): Checked {
  switch (op.op) {
    case 'insert_tier': return checkInsertTier(g, op);
    case 'remove_tier': return checkRemoveTier(g, op);
    case 'stretch': return checkStretch(g, op);
    case 'recolor': return checkRecolor(g, op);
    case 'rotate': return checkRotate(g, op);
    case 'swap_view': return checkSwapView(g, op);
    default: return fail(`unknown op: ${op.op}`);
  }
}

function fail(reason: string): Checked {
  return { ok: false, reason };
}

function bySlot(a: GraphNode, b: GraphNode): number {
  return a.frame.y - b.frame.y || a.seq - b.seq;
}

// most specific whitelist wins: the node's own, else the nearest ancestor's.
// a shelf's whitelist governs its subtree unless a part declares its own.
function findWhitelist(g: Graph, nodeId: string): WhitelistConstraint | undefined {
  let id: string | null = nodeId;
  while (id !== null) {
    const wl = Object.values(g.constraints).find(
      (c): c is WhitelistConstraint => c.type === 'whitelist' && globMatch(c.node, id as string)
    );
    if (wl) return wl;
    const node: GraphNode | undefined = g.nodes[id];
    id = node ? node.parent : null;
  }
  return undefined;
}

// --- ratio validation (the fixed constraint setting) ---

function propValue(n: GraphNode, prop: string): number {
  const key = prop.slice('frame.'.length);
  return (n.frame as unknown as Record<string, number>)[key];
}

function refValue(g: Graph, ref: RatioRef): { node: string | null; value: number }[] {
  if (ref.value !== undefined) return [{ node: null, value: ref.value }];
  const prop = ref.prop ?? 'frame.h';
  return liveNodes(g, ref.node ?? '').map((n) => ({ node: n.id, value: propValue(n, prop) }));
}

export function checkRatios(g: Graph): string[] {
  const violations: string[] = [];
  for (const c of Object.values(g.constraints)) {
    if (c.type !== 'ratio') continue;
    const dens = refValue(g, c.denominator);
    if (dens.length !== 1) {
      violations.push(`ratio ${c.id}: denominator must resolve to exactly one value (got ${dens.length})`);
      continue;
    }
    const den = dens[0].value;
    for (const num of refValue(g, c.numerator)) {
      if (den === 0) {
        violations.push(`ratio ${c.id}: division by zero at ${num.node ?? c.id}`);
        continue;
      }
      const r = num.value / den;
      if (r < c.range[0] - EPS || r > c.range[1] + EPS) {
        violations.push(
          `ratio ${c.id} violated at ${num.node ?? c.id}: ${r.toFixed(4)} outside [${c.range[0]}, ${c.range[1]}]`
        );
      }
    }
  }
  return violations;
}

function validate(g2: Graph): Checked | null {
  const v = checkRatios(g2);
  if (v.length > 0) return fail(v[0]);
  return null;
}

// --- ops ---

function checkInsertTier(g: Graph, op: EditOp): Checked {
  if (!op.target) return fail('insert_tier needs a target');
  const target = op.target;
  const carcass = getNode(g, target);
  if (carcass.deleted) return fail(`${target} is a tombstone`);
  const wl = findWhitelist(g, target);
  const rule = wl?.ops['insert_tier'] as
    | { min?: number; max?: number; at?: string[]; respacing?: string }
    | undefined;
  if (!rule) return fail(`insert_tier is not whitelisted for ${target} — ${carcass.role}s may not grow tiers`);

  const params = op.params ?? {};
  const count = Number(params.count ?? 1);
  if (!Number.isInteger(count) || count < 1) return fail(`count must be a positive integer, got ${params.count ?? 1}`);
  const at = String(params.at ?? 'top');
  if (rule.at && !rule.at.includes(at)) {
    return fail(`insert at '${at}' not allowed for ${target} (allowed: ${rule.at.join(', ')})`);
  }

  const tiers = liveChildren(g, target, 'tier');
  const n0 = tiers.length;
  if (n0 === 0) return fail(`no live tier under ${target} to clone — insertion needs a template`);
  const max = rule.max !== undefined ? Number(rule.max) : Infinity;
  if (n0 + count > max) return fail(`tier count ${n0 + count} exceeds whitelist max ${max}`);

  const sorted = [...tiers].sort(bySlot);
  const template = at === 'bottom' ? sorted[0] : sorted[sorted.length - 1];
  const n1 = n0 + count;
  const newH = carcass.frame.h / n1;
  const slotFrame = (i: number): Frame => ({
    x: template.frame.x,
    y: i * newH,
    w: template.frame.w,
    h: newH,
    ...(template.frame.rotation !== undefined ? { rotation: template.frame.rotation } : {}),
  });

  const reserved: string[] = [];
  const newIds = Array.from({ length: count }, () => freshId(g, template.id, reserved));

  const effects: Effect[] = [];
  if (at === 'bottom') {
    newIds.forEach((id, i) => effects.push({ kind: 'clone-node', from: template.id, to: id, frame: slotFrame(i) }));
    sorted.forEach((t, i) => effects.push({ kind: 'set-frame', node: t.id, frame: slotFrame(count + i) }));
  } else {
    sorted.forEach((t, i) => effects.push({ kind: 'set-frame', node: t.id, frame: slotFrame(i) }));
    newIds.forEach((id, i) => effects.push({ kind: 'clone-node', from: template.id, to: id, frame: slotFrame(n0 + i) }));
  }

  const bad = validate(applyEffects(g, effects));
  if (bad) return bad;
  return { ok: true, effects };
}

function checkRemoveTier(g: Graph, op: EditOp): Checked {
  if (!op.target) return fail('remove_tier needs a target');
  const target = op.target;
  const carcass = getNode(g, target);
  if (carcass.deleted) return fail(`${target} is a tombstone`);
  const wl = findWhitelist(g, target);
  const rule = wl?.ops['remove_tier'] as { min?: number } | undefined;
  if (!rule) return fail(`remove_tier is not whitelisted for ${target}`);

  const params = op.params ?? {};
  const tiers = liveChildren(g, target, 'tier').sort(bySlot);
  const n0 = tiers.length;
  if (n0 === 0) return fail(`no live tier under ${target}`);
  const min = rule.min !== undefined ? Number(rule.min) : 1;
  if (n0 - 1 < min) return fail(`removal would leave ${n0 - 1} tier(s) below whitelist min ${min}`);

  let victim: GraphNode;
  if (typeof params.tier === 'string') {
    victim = getNode(g, params.tier);
    if (victim.deleted || victim.parent !== target || victim.role !== 'tier') {
      return fail(`${params.tier} is not a live tier of ${target}`);
    }
  } else {
    victim = params.at === 'bottom' ? tiers[0] : tiers[n0 - 1];
  }

  const survivors = tiers.filter((t) => t.id !== victim.id);
  const effects: Effect[] = [{ kind: 'tombstone', node: victim.id }];
  if (survivors.length > 0) {
    const first = survivors[0];
    const newH = carcass.frame.h / survivors.length;
    survivors.forEach((t, i) =>
      effects.push({
        kind: 'set-frame',
        node: t.id,
        frame: {
          x: first.frame.x,
          y: i * newH,
          w: first.frame.w,
          h: newH,
          ...(first.frame.rotation !== undefined ? { rotation: first.frame.rotation } : {}),
        },
      })
    );
  }

  const bad = validate(applyEffects(g, effects));
  if (bad) return bad;
  return { ok: true, effects };
}

function checkStretch(g: Graph, op: EditOp): Checked {
  if (!op.target) return fail('stretch needs a target');
  const node = getNode(g, op.target);
  if (node.deleted) return fail(`${op.target} is a tombstone`);
  const wl = findWhitelist(g, op.target);
  const rule = wl?.ops['stretch'] as { axes?: string[] } | undefined;
  if (!rule) return fail(`stretch is not whitelisted for ${op.target}`);

  const params = op.params ?? {};
  const axis = String(params.axis ?? '');
  if (axis !== 'w' && axis !== 'h') return fail(`stretch axis must be 'w' or 'h', got '${axis}'`);
  if (rule.axes && !rule.axes.includes(axis)) {
    return fail(`stretch on '${axis}' not allowed for ${op.target} (allowed: ${rule.axes.join(', ')})`);
  }
  const factor = Number(params.factor);
  if (!Number.isFinite(factor) || factor <= 0) return fail(`factor must be a positive number, got ${params.factor}`);

  const newLen = node.frame[axis] * factor;
  const newFrame = { ...node.frame };
  if (axis === 'w') newFrame.w = newLen;
  else newFrame.h = newLen;

  const effects: Effect[] = [{ kind: 'set-frame', node: node.id, frame: newFrame }];

  // stretching the carcass height respaces its tiers — consults the ratio locks.
  const tiers = liveChildren(g, node.id, 'tier');
  if (axis === 'h' && tiers.length > 0) {
    const sorted = [...tiers].sort(bySlot);
    const template = sorted[0];
    const newH = newLen / sorted.length;
    sorted.forEach((t, i) =>
      effects.push({
        kind: 'set-frame',
        node: t.id,
        frame: {
          x: template.frame.x,
          y: i * newH,
          w: template.frame.w,
          h: newH,
          ...(template.frame.rotation !== undefined ? { rotation: template.frame.rotation } : {}),
        },
      })
    );
  }

  const bad = validate(applyEffects(g, effects));
  if (bad) return bad;
  return { ok: true, effects };
}

function checkRecolor(g: Graph, op: EditOp): Checked {
  if (!op.target) return fail('recolor needs a target');
  const node = getNode(g, op.target);
  if (node.deleted) return fail(`${op.target} is a tombstone`);
  const wl = findWhitelist(g, op.target);
  if (!wl?.ops['recolor']) return fail(`recolor is not whitelisted for ${op.target}`);

  const params = op.params ?? {};
  const key = typeof params.key === 'string' ? params.key : 'fill';
  const value = params.value !== undefined ? params.value : params.fill;
  if (value === undefined || (typeof value !== 'string' && typeof value !== 'number')) {
    return fail('recolor needs a fill (or key/value)');
  }
  return { ok: true, effects: [{ kind: 'set-attr', node: node.id, key, value: value as string | number }] };
}

function checkRotate(g: Graph, op: EditOp): Checked {
  if (!op.target) return fail('rotate needs a target');
  const node = getNode(g, op.target);
  if (node.deleted) return fail(`${op.target} is a tombstone`);
  const wl = findWhitelist(g, op.target);
  if (!wl?.ops['rotate']) return fail(`rotate is not whitelisted for ${op.target}`);

  const deg = Number(op.params?.deg);
  if (!Number.isFinite(deg)) return fail('rotate needs a numeric deg');
  const rotation = (((node.frame.rotation ?? 0) + deg) % 360 + 360) % 360;
  return { ok: true, effects: [{ kind: 'set-frame', node: node.id, frame: { ...node.frame, rotation } }] };
}

function checkSwapView(g: Graph, op: EditOp): Checked {
  const view = String(op.params?.view ?? '');
  if (!g.views.some((v) => v.name === view)) {
    return fail(`unknown view: ${view} (views: ${g.views.map((v) => v.name).join(', ')})`);
  }
  return { ok: true, effects: [{ kind: 'set-view', view }] };
}
