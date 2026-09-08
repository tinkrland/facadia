// facadia — rule table loader. normalizes authored json into RuleLayer and
// expands `extends` (a city pulling in its vernacular family) into a flat stack.
//
// authored files stay flat and human-diffable:
//   { "id": "london", "extends": ["british"], "roof": { "gable": { "weight": 4 } } }
// every key that is not metadata is a subsystem.

import type { Entry, LayerKind, RuleLayer, SliderEffect } from './types';

const META = new Set(['id', 'kind', 'extends', 'effects', 'default', '$comment', '$schema']);

export interface RawLayer {
  id?: string;
  kind?: string;
  extends?: string[];
  effects?: SliderEffect[];
  default?: number;
  [subsystem: string]: unknown;
}

/** a library of layers, addressed as `<kind>:<id>` and also bare `<id>` when unambiguous. */
export type LayerLibrary = Map<string, RuleLayer>;

export function layerKey(kind: LayerKind, id: string): string {
  return `${kind}:${id}`;
}

/** normalize one authored table. `kind` comes from the directory it was loaded from. */
export function normalizeLayer(raw: RawLayer, kind: LayerKind, fallbackId?: string): RuleLayer {
  const id = raw.id ?? fallbackId;
  if (!id) throw new Error(`rule layer is missing an id (kind: ${kind})`);

  const subsystems: Record<string, Record<string, Entry>> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (META.has(name)) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${kind}:${id} — subsystem '${name}' must be an object of key -> entry`);
    }
    const bucket: Record<string, Entry> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      bucket[key] = normalizeEntry(entry, `${kind}:${id}.${name}.${key}`);
    }
    subsystems[name] = bucket;
  }

  const layer: RuleLayer = { id, kind, subsystems };
  if (raw.extends?.length) layer.extends = [...raw.extends];
  if (raw.effects?.length) layer.effects = raw.effects.map((e) => ({ ...e }));
  if (typeof raw.default === 'number') layer.default = raw.default;
  return layer;
}

function normalizeEntry(entry: unknown, where: string): Entry {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${where} — entry must be an object like { weight: 4 } or { forbid: true }`);
  }
  const e = entry as Record<string, unknown>;
  const out: Entry = {};

  if (e.weight !== undefined) {
    const w = Number(e.weight);
    if (!Number.isFinite(w) || w < 0) throw new Error(`${where} — weight must be a finite number >= 0`);
    out.weight = w;
  }
  if (e.forbid !== undefined) {
    if (e.forbid !== true) throw new Error(`${where} — forbid, when present, must be true`);
    out.forbid = true;
  }
  if (e.require !== undefined) {
    if (e.require !== true) throw new Error(`${where} — require, when present, must be true`);
    out.require = true;
  }
  if (e.range !== undefined) {
    const r = e.range;
    if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => Number.isFinite(Number(n)))) {
      throw new Error(`${where} — range must be [lo, hi]`);
    }
    const lo = Number(r[0]);
    const hi = Number(r[1]);
    if (lo > hi) throw new Error(`${where} — range lo (${lo}) is greater than hi (${hi})`);
    out.range = [lo, hi];
  }
  if (out.forbid && out.require) {
    throw new Error(`${where} — a single entry cannot both forbid and require`);
  }
  return out;
}

/** build a library from `{ family: { british: {...} }, city: { london: {...} } }`. */
export function loadLibrary(bundle: Partial<Record<LayerKind, Record<string, RawLayer>>>): LayerLibrary {
  const lib: LayerLibrary = new Map();
  for (const [kind, tables] of Object.entries(bundle) as [LayerKind, Record<string, RawLayer>][]) {
    for (const [fileId, raw] of Object.entries(tables ?? {})) {
      const layer = normalizeLayer(raw, kind, fileId);
      lib.set(layerKey(kind, layer.id), layer);
    }
  }
  return lib;
}

export function getLayer(lib: LayerLibrary, kind: LayerKind, id: string): RuleLayer {
  const layer = lib.get(layerKey(kind, id));
  if (!layer) throw new Error(`no ${kind} layer '${id}' in the library`);
  return layer;
}

/**
 * expand a selection into the flat stack the resolver consumes.
 *
 * `extends` is stack ordering, not a deep merge: a family is pushed *beneath* the
 * city that inherits it, so the city's own weights multiply on top and the family
 * stays independently diffable. cycles are broken, each layer appears once.
 */
export function expandStack(
  lib: LayerLibrary,
  selection: Partial<Record<LayerKind, string>>,
  onMissing: (ref: string) => void = () => {}
): RuleLayer[] {
  const out: RuleLayer[] = [];
  const seen = new Set<string>();

  const push = (layer: RuleLayer, trail: Set<string>): void => {
    const key = layerKey(layer.kind, layer.id);
    if (seen.has(key) || trail.has(key)) return;
    const nextTrail = new Set(trail).add(key);
    for (const ref of layer.extends ?? []) {
      const parent = resolveRef(lib, ref);
      if (!parent) {
        onMissing(`${key} extends '${ref}', which is not in the library`);
        continue;
      }
      push(parent, nextTrail);
    }
    seen.add(key);
    out.push(layer);
  };

  // stack in precedence order so the flat array reads family -> ... -> slider
  for (const kind of ['family', 'city', 'era', 'typology', 'condition'] as LayerKind[]) {
    const id = selection[kind];
    if (!id) continue;
    push(getLayer(lib, kind, id), new Set());
  }
  return out;
}

/** `"british"` or `"family:british"` -> the layer, searching families first. */
function resolveRef(lib: LayerLibrary, ref: string): RuleLayer | undefined {
  if (ref.includes(':')) return lib.get(ref);
  for (const kind of ['family', 'city', 'era', 'typology', 'condition'] as LayerKind[]) {
    const hit = lib.get(layerKey(kind, ref));
    if (hit) return hit;
  }
  return undefined;
}
