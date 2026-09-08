// facadia — seeded sampling. the ONLY place randomness enters the rule side.
//
// generation samples; switching a layer does not (see diff.ts). same seed +
// same stack = the same building, byte for byte, forever. that is what makes a
// generated street reproducible from a short recipe instead of a stored blob.

import { sha256Hex } from '../util/sha256';
import type { Resolved, ResolvedEntry } from './types';
import { candidates, requiredKeys } from './resolve';

/** mulberry32, seeded from the first 32 bits of sha256(seed) — stable across node and the browser. */
export function createRng(seed: string): () => number {
  let a = parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** derive an independent, reproducible stream for one subsystem of one building. */
export function substream(seed: string, ...path: (string | number)[]): () => number {
  return createRng([seed, ...path].join('/'));
}

/** weighted choice over live candidates. returns null when the vocabulary is empty. */
export function pickWeighted(rng: () => number, entries: ResolvedEntry[]): ResolvedEntry | null {
  const live = entries.filter((e) => e.weight > 0);
  if (live.length === 0) return null;
  const total = live.reduce((sum, e) => sum + e.weight, 0);
  if (!(total > 0)) return null;

  let roll = rng() * total;
  for (const e of live) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return live[live.length - 1]; // float slack
}

export function sampleRange(rng: () => number, range: [number, number]): number {
  const [lo, hi] = range;
  return lo + rng() * (hi - lo);
}

export function sampleInt(rng: () => number, range: [number, number]): number {
  const lo = Math.ceil(range[0]);
  const hi = Math.floor(range[1]);
  if (hi < lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * choose one key from a subsystem, honouring required-first.
 * a required key is not "very likely" — it is the answer.
 */
export function chooseOne(r: Resolved, name: string, rng: () => number): string | null {
  const must = requiredKeys(r, name).filter((e) => e.weight > 0);
  if (must.length === 1) return must[0].key;
  if (must.length > 1) return pickWeighted(rng, must)?.key ?? null;
  return pickWeighted(rng, candidates(r, name))?.key ?? null;
}

/**
 * choose the set of optional features present in a subsystem: every required key,
 * plus each remaining key with probability derived from its weight. this is how
 * "fire escape: required in new york, uncommon in london" reads at generation time.
 */
export function chooseMany(r: Resolved, name: string, rng: () => number): string[] {
  const out: string[] = [];
  for (const e of candidates(r, name)) {
    if (e.required) {
      out.push(e.key);
      continue;
    }
    // weight 1 (allowed) -> 50%, 4 (preferred) -> 80%, 0.15 (uncommon) -> ~13%
    const p = e.weight / (e.weight + 1);
    if (rng() < p) out.push(e.key);
  }
  return out.sort();
}

/**
 * the typology the stack was built with, if the caller selected one.
 *
 * a city's `typologies` table says what is *common* around here — it is how you ask
 * for "a building that belongs in london". but once a typology layer is on the stack
 * the answer is already given, and sampling one anyway would let set_city quietly turn
 * a townhouse into a semi-detached. selection beats preference.
 */
export function selectedTypology(r: Resolved): string | null {
  const hit = r.stack.find((id) => id.startsWith('typology:'));
  return hit ? hit.slice('typology:'.length) : null;
}

function numberFrom(
  r: Resolved,
  name: string,
  key: string,
  rng: () => number,
  fallback: [number, number],
  integer = false
): number {
  const range = r.subsystems[name]?.[key]?.range ?? fallback;
  return integer ? sampleInt(rng, range) : sampleRange(rng, range);
}

/**
 * a building recipe: the plain, serializable description of one building.
 *
 * this is deliberately NOT a graph. the recipe is what the rule side produces and
 * what a street stores per building (a seed plus a selection reproduces it); the
 * graph builder turns a recipe into nodes. keeping the boundary here is what stops
 * the rule tables from having opinions about frames.
 */
export interface BuildingRecipe {
  seed: string;
  stack: string[];
  typology: string | null;
  massing: { floors: number; width: number; verticality: number };
  roof: { form: string | null; material: string | null; accessories: string[] };
  facade: { material: string | null; ornamentDensity: number };
  windows: { style: string | null };
  entrance: { type: string | null };
  ground: { setback: number; features: string[] };
  details: string[];
  attachments: string[];
  vegetation: string[];
  conflicts: string[];
}

/**
 * sample one building from a resolved stack. pure given (resolved, seed).
 * every subsystem draws from its own substream, so adding a subsystem later does
 * not reshuffle the ones already sampled — old seeds keep producing old buildings.
 */
export function sampleBuilding(r: Resolved, seed: string): BuildingRecipe {
  const s = (...path: (string | number)[]) => substream(seed, ...path);

  const massingRng = s('massing');
  const floors = numberFrom(r, 'massing', 'floors', massingRng, [1, 3], true);
  const width = numberFrom(r, 'massing', 'width', massingRng, [0.3, 0.7]);
  const verticality = numberFrom(r, 'massing', 'verticality', massingRng, [0.3, 0.7]);

  const groundRng = s('ground');
  const setback = numberFrom(r, 'ground', 'setback', groundRng, [0, 1]);

  return {
    seed,
    stack: [...r.stack],
    typology: selectedTypology(r) ?? chooseOne(r, 'typologies', s('typology')),
    massing: { floors, width, verticality },
    roof: {
      form: chooseOne(r, 'roof', s('roof')),
      material: chooseOne(r, 'roof_material', s('roof_mat')),
      accessories: chooseMany(r, 'roof_accessories', s('roof_acc')),
    },
    facade: {
      material: chooseOne(r, 'facade', s('facade')),
      ornamentDensity: numberFrom(r, 'ornament', 'density', s('ornament'), [0, 0.5]),
    },
    windows: { style: chooseOne(r, 'windows', s('windows')) },
    entrance: { type: chooseOne(r, 'entrance', s('entrance')) },
    ground: { setback, features: chooseMany(r, 'ground', groundRng).filter((k) => k !== 'setback') },
    details: chooseMany(r, 'details', s('details')),
    attachments: chooseMany(r, 'attachments', s('attachments')),
    vegetation: chooseMany(r, 'vegetation', s('vegetation')),
    conflicts: r.conflicts.map((c) => c.detail),
  };
}
