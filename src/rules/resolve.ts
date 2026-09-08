// facadia — the resolver. stacked rule layers -> one effective vocabulary.
//
// pure and total: (layers, sliderBindings) -> Resolved. no randomness in here.
// sampling is a separate step, and a *layer switch* never samples at all — it
// diffs two Resolved snapshots (see diff.ts).
//
// the three rules that make this architecture rather than a lookup table:
//   1. weights MULTIPLY across layers  — london × victorian × townhouse
//   2. forbid is ABSORBING             — nothing resurrects it, at any weight
//   3. ranges INTERSECT                — a cottage stays a cottage in manhattan

import type {
  Conflict,
  Entry,
  Resolved,
  ResolvedEntry,
  RuleLayer,
  SliderEffect,
} from './types';
import { PRECEDENCE, compatOf } from './types';

interface Vote {
  layer: RuleLayer;
  entry: Entry;
}

export interface SliderBinding {
  layer: RuleLayer; // kind: 'slider'
  value?: number;   // 0..1; falls back to the slider's own default, else 0.5
}

export function resolve(layers: RuleLayer[], sliders: SliderBinding[] = []): Resolved {
  const conflicts: Conflict[] = [];
  const votes = collectVotes(layers);

  const subsystems: Record<string, Record<string, ResolvedEntry>> = {};
  for (const [subsystem, keys] of votes) {
    const bucket: Record<string, ResolvedEntry> = {};
    for (const [key, cast] of keys) {
      bucket[key] = resolveKey(subsystem, key, cast, conflicts);
    }
    subsystems[subsystem] = bucket;
  }

  const resolved: Resolved = {
    subsystems,
    stack: layers.map((l) => `${l.kind}:${l.id}`),
    conflicts,
  };

  for (const binding of sliders) applySlider(resolved, binding);
  return resolved;
}

/** subsystem -> key -> every layer that voted on it, in stack order. */
function collectVotes(layers: RuleLayer[]): Map<string, Map<string, Vote[]>> {
  const votes = new Map<string, Map<string, Vote[]>>();
  for (const layer of layers) {
    for (const [subsystem, keys] of Object.entries(layer.subsystems)) {
      let bySub = votes.get(subsystem);
      if (!bySub) votes.set(subsystem, (bySub = new Map()));
      for (const [key, entry] of Object.entries(keys)) {
        const list = bySub.get(key);
        if (list) list.push({ layer, entry });
        else bySub.set(key, [{ layer, entry }]);
      }
    }
  }
  return votes;
}

function resolveKey(subsystem: string, key: string, cast: Vote[], conflicts: Conflict[]): ResolvedEntry {
  let weight = 1;
  let required = false;
  let forbidden = false;
  const sources: string[] = [];
  const requiredBy: string[] = [];
  const forbiddenBy: string[] = [];

  for (const { layer, entry } of cast) {
    const id = `${layer.kind}:${layer.id}`;
    sources.push(id);
    // silence is neutral; an explicit weight multiplies.
    if (entry.weight !== undefined) weight *= entry.weight;
    if (entry.require) {
      required = true;
      requiredBy.push(id);
    }
    if (entry.forbid) {
      forbidden = true;
      forbiddenBy.push(id);
    }
  }

  // a real architectural contradiction: new_york requires a fire escape, cottage
  // forbids one. forbid wins (it is the harder claim), and we say so out loud
  // rather than quietly building a cottage with a fire escape bolted to it.
  if (forbidden && required) {
    conflicts.push({
      kind: 'require-vs-forbid',
      subsystem,
      key,
      layers: [...new Set([...requiredBy, ...forbiddenBy])],
      detail: `${subsystem}.${key} is required by ${requiredBy.join(', ')} but forbidden by ${forbiddenBy.join(
        ', '
      )} — forbid wins`,
    });
    required = false;
  }
  if (forbidden) weight = 0;

  const range = intersectRanges(subsystem, key, cast, conflicts);

  return {
    key,
    weight,
    compat: compatOf(weight, required),
    required,
    forbidden,
    ...(range ? { range } : {}),
    sources,
  };
}

/**
 * intersect every declared range. if the intersection is empty the layers genuinely
 * disagree about scale (a 6-storey cottage), so we report it and defer to the
 * highest-precedence layer rather than inventing a compromise nobody authored.
 */
function intersectRanges(
  subsystem: string,
  key: string,
  cast: Vote[],
  conflicts: Conflict[]
): [number, number] | undefined {
  const ranged = cast.filter((v) => v.entry.range);
  if (ranged.length === 0) return undefined;

  let lo = -Infinity;
  let hi = Infinity;
  for (const { entry } of ranged) {
    const [a, b] = entry.range as [number, number];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (lo <= hi) return [lo, hi];

  const winner = [...ranged].sort(
    (a, b) => PRECEDENCE[a.layer.kind] - PRECEDENCE[b.layer.kind]
  )[ranged.length - 1];
  conflicts.push({
    kind: 'empty-range',
    subsystem,
    key,
    layers: ranged.map((v) => `${v.layer.kind}:${v.layer.id}`),
    detail: `${subsystem}.${key} ranges do not overlap — deferring to ${winner.layer.kind}:${winner.layer.id}`,
  });
  return winner.entry.range as [number, number];
}

// --- sliders: global modifiers, applied after the categorical layers ---

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** "details.*" -> { subsystem: "details", key: "*" } */
function splitTarget(target: string): { subsystem: string; key: string } {
  const dot = target.indexOf('.');
  if (dot < 0) return { subsystem: target, key: '*' };
  return { subsystem: target.slice(0, dot), key: target.slice(dot + 1) };
}

/**
 * slider targets match vocabulary keys, not node ids, so this is deliberately not
 * graph.ts's globMatch: keys are flat words ('cornice'), and a bare '*' must match
 * every key in the subsystem.
 */
export function keyMatch(pattern: string, key: string): boolean {
  if (pattern === '*' || pattern === key) return true;
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
  return false;
}

export function sliderValue(binding: SliderBinding): number {
  const raw = binding.value ?? binding.layer.default ?? 0.5;
  return Math.min(1, Math.max(0, raw));
}

/**
 * a slider multiplies weights and lerps ranges on whatever it targets. it can make
 * something rare or dominant — it can never make a forbidden thing legal, because
 * forbid already collapsed the weight to 0 and 0 times anything is still 0.
 */
export function applySlider(resolved: Resolved, binding: SliderBinding): void {
  const t = sliderValue(binding);
  const id = `slider:${binding.layer.id}`;

  for (const effect of binding.layer.effects ?? []) {
    const { subsystem, key } = splitTarget(effect.target);
    const bucket = resolved.subsystems[subsystem];
    if (!bucket) continue;

    for (const entry of Object.values(bucket)) {
      if (!keyMatch(key, entry.key)) continue;
      applyEffect(entry, effect, t);
      if (!entry.sources.includes(id)) entry.sources.push(id);
      entry.compat = compatOf(entry.weight, entry.required);
    }
  }
  if (!resolved.stack.includes(id)) resolved.stack.push(id);
}

function applyEffect(entry: ResolvedEntry, effect: SliderEffect, t: number): void {
  if (effect.at0 !== undefined || effect.at1 !== undefined) {
    entry.weight *= lerp(effect.at0 ?? 1, effect.at1 ?? 1, t);
  }
  if (effect.rangeAt0 && effect.rangeAt1) {
    const lo = lerp(effect.rangeAt0[0], effect.rangeAt1[0], t);
    const hi = lerp(effect.rangeAt0[1], effect.rangeAt1[1], t);
    // stay inside whatever the categorical layers already permitted
    entry.range = entry.range
      ? [Math.max(entry.range[0], Math.min(lo, entry.range[1])), Math.min(entry.range[1], Math.max(hi, entry.range[0]))]
      : [Math.min(lo, hi), Math.max(lo, hi)];
  }
}

// --- reading a resolution ---

export function subsystem(r: Resolved, name: string): ResolvedEntry[] {
  return Object.values(r.subsystems[name] ?? {});
}

/** everything still on the table for a subsystem, strongest first. */
export function candidates(r: Resolved, name: string): ResolvedEntry[] {
  return subsystem(r, name)
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function requiredKeys(r: Resolved, name: string): ResolvedEntry[] {
  return subsystem(r, name).filter((e) => e.required);
}

export function forbiddenKeys(r: Resolved, name: string): ResolvedEntry[] {
  return subsystem(r, name).filter((e) => e.forbidden);
}

/** the compat tier for one key — 'forbidden' when no layer has ever heard of it. */
export function compatFor(r: Resolved, name: string, key: string): ResolvedEntry['compat'] {
  return r.subsystems[name]?.[key]?.compat ?? 'forbidden';
}
