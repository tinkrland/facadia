// facadia — style-layer tests. same spirit as phase 1: the invariants ARE the suite.
//
// the one that matters most is the last describe block: switching a style layer
// must be a bounded diff, never a regeneration. if that test goes green while a
// london townhouse turns into a different building on set_city, facadia has failed
// exactly the way svgery refuses to.

import { describe, expect, it } from 'vitest';
import { DIR_KINDS, readBundle, readTables, rulesLibrary } from './rules-fixture';
import { expandStack, getLayer, normalizeLayer } from '../src/rules/load';
import {
  candidates,
  compatFor,
  forbiddenKeys,
  requiredKeys,
  resolve,
  type SliderBinding,
} from '../src/rules/resolve';
import { chooseOne, createRng, pickWeighted, sampleBuilding, type BuildingRecipe } from '../src/rules/sample';
import { edits, switchStack } from '../src/rules/diff';
import type { LayerKind, RuleLayer } from '../src/rules/types';
import { compatOf } from '../src/rules/types';

const lib = rulesLibrary();

function stackFor(selection: Partial<Record<LayerKind, string>>): RuleLayer[] {
  return expandStack(lib, selection);
}

function resolveFor(
  selection: Partial<Record<LayerKind, string>>,
  sliders: SliderBinding[] = []
) {
  return resolve(stackFor(selection), sliders);
}

const LONDON_TOWNHOUSE = { city: 'london', typology: 'townhouse', era: 'victorian' } as const;

// --- the committed tables must actually load ---

describe('rule tables on disk', () => {
  it('every committed table normalizes under the schema', () => {
    for (const [dir, kind] of Object.entries(DIR_KINDS)) {
      const tables = readTables(dir);
      expect(Object.keys(tables).length, `${dir} is empty`).toBeGreaterThan(0);
      for (const [fileId, raw] of Object.entries(tables)) {
        expect(() => normalizeLayer(raw, kind, fileId), `${dir}/${fileId}.json`).not.toThrow();
        // the filename is the address the loader indexes by — it must match the id
        expect(raw.id ?? fileId, `${dir}/${fileId}.json id mismatch`).toBe(fileId);
      }
    }
  });

  it('every `extends` reference resolves to a real layer', () => {
    const missing: string[] = [];
    for (const kind of Object.keys(DIR_KINDS)) {
      for (const id of Object.keys(readTables(kind))) {
        const layerKind = DIR_KINDS[kind];
        expandStack(lib, { [layerKind]: id } as Partial<Record<LayerKind, string>>, (m) => missing.push(m));
      }
    }
    expect(missing).toEqual([]);
  });

  it('rejects a malformed entry rather than silently ignoring it', () => {
    expect(() => normalizeLayer({ id: 'x', roof: { gable: true } } as never, 'city')).toThrow(/entry must be an object/);
    expect(() => normalizeLayer({ id: 'x', roof: { gable: { weight: -2 } } }, 'city')).toThrow(/weight/);
    expect(() => normalizeLayer({ id: 'x', massing: { floors: { range: [5, 2] } } }, 'city')).toThrow(/greater than/);
    expect(() => normalizeLayer({ id: 'x', roof: { gable: { forbid: true, require: true } } }, 'city')).toThrow(
      /cannot both forbid and require/
    );
  });
});

// --- resolution: the three rules ---

describe('rule 1: weights multiply across the stack', () => {
  it('a city preference and a typology preference compound', () => {
    const city = getLayer(lib, 'city', 'london');
    const typ = getLayer(lib, 'typology', 'townhouse');
    const solo = resolve([city]);
    const both = resolve([city, typ]);
    const w = (r: ReturnType<typeof resolve>, k: string) => r.subsystems.roof?.[k]?.weight ?? 0;
    // london says mansard 1.5, townhouse says mansard 3 -> 4.5, strictly more than either
    expect(w(both, 'mansard')).toBeCloseTo(w(solo, 'mansard') * 3, 6);
  });

  it('a layer that is silent about a key does not vote on it', () => {
    const withEra = resolveFor(LONDON_TOWNHOUSE);
    const withoutEra = resolveFor({ city: 'london', typology: 'townhouse' });
    // victorian says nothing about facade materials, so they are untouched
    expect(withEra.subsystems.facade.red_brick.weight).toBe(withoutEra.subsystems.facade.red_brick.weight);
  });

  it('resolution is pure — the same stack twice gives the same numbers', () => {
    const a = resolveFor(LONDON_TOWNHOUSE);
    const b = resolveFor(LONDON_TOWNHOUSE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('rule 2: forbid is absorbing', () => {
  it('nothing outweighs a forbid, however preferred elsewhere', () => {
    // north_american_urban likes brownstone (4); san francisco forbids it outright
    const r = resolveFor({ city: 'san_francisco' });
    expect(r.subsystems.facade.brownstone.weight).toBe(0);
    expect(r.subsystems.facade.brownstone.forbidden).toBe(true);
    expect(compatFor(r, 'facade', 'brownstone')).toBe('forbidden');
  });

  it('a forbidden key is never sampled, over many seeds', () => {
    const r = resolveFor({ city: 'new_york', typology: 'brownstone' });
    for (let i = 0; i < 400; i++) {
      expect(sampleBuilding(r, `seed-${i}`).ground.features).not.toContain('front_garden');
    }
  });

  it('an unknown key is forbidden, not quietly allowed', () => {
    expect(compatFor(resolveFor({ city: 'london' }), 'roof', 'pagoda')).toBe('forbidden');
  });
});

describe('rule 3: ranges intersect', () => {
  it('a cottage stays cottage-sized wherever it is placed', () => {
    const inLondon = resolveFor({ city: 'london', typology: 'cottage' });
    const inTokyo = resolveFor({ city: 'tokyo', typology: 'cottage' });
    // tokyo says 2-5 floors, cottage says 1-2 -> the overlap is exactly 2
    expect(inLondon.subsystems.massing.floors.range).toEqual([1, 2]);
    expect(inTokyo.subsystems.massing.floors.range).toEqual([2, 2]);
  });

  it('non-overlapping ranges are reported, never silently averaged', () => {
    const tall = normalizeLayer({ id: 'tall', massing: { floors: { range: [6, 10] } } }, 'city');
    const small = normalizeLayer({ id: 'small', massing: { floors: { range: [1, 2] } } }, 'typology');
    const r = resolve([tall, small]);
    const conflict = r.conflicts.find((c) => c.kind === 'empty-range');
    expect(conflict).toBeDefined();
    expect(conflict?.detail).toContain('typology:small'); // typology outranks city on massing
    expect(r.subsystems.massing.floors.range).toEqual([1, 2]);
  });
});

// --- compatibility: the five tiers, and the conflict that matters ---

describe('compatibility tiers', () => {
  it('maps weights onto the concept guide vocabulary', () => {
    expect(compatOf(0, false)).toBe('forbidden');
    expect(compatOf(3, true)).toBe('required');
    expect(compatOf(0.15, false)).toBe('uncommon');
    expect(compatOf(1, false)).toBe('allowed');
    expect(compatOf(4, false)).toBe('preferred');
  });

  it('a new york cottage surfaces the fire-escape contradiction instead of building it', () => {
    // new_york requires a fire escape; the cottage dna forbids one. that is a real
    // architectural contradiction and the resolver has to say so out loud.
    const r = resolveFor({ city: 'new_york', typology: 'cottage' });
    const conflict = r.conflicts.find((c) => c.key === 'fire_escape');
    expect(conflict?.kind).toBe('require-vs-forbid');
    expect(conflict?.layers).toEqual(expect.arrayContaining(['city:new_york', 'typology:cottage']));
    // forbid wins — no cottage gets a fire escape bolted on
    expect(r.subsystems.details.fire_escape.weight).toBe(0);
    expect(r.subsystems.details.fire_escape.required).toBe(false);
    expect(sampleBuilding(r, 'anything').details).not.toContain('fire_escape');
  });

  it('a new york brownstone keeps its fire escape as required', () => {
    const r = resolveFor({ city: 'new_york', typology: 'brownstone' });
    expect(r.conflicts.filter((c) => c.key === 'fire_escape')).toEqual([]);
    expect(compatFor(r, 'details', 'fire_escape')).toBe('required');
    expect(sampleBuilding(r, 'whatever').details).toContain('fire_escape');
  });
});

// --- vernacular families: cities as presets over a family ---

describe('vernacular families', () => {
  it('a city stacks its family beneath itself, not merged into it', () => {
    const stack = stackFor({ city: 'london' }).map((l) => `${l.kind}:${l.id}`);
    expect(stack).toEqual(['family:british', 'city:london']);
  });

  it('cities of one family share a substrate but stay distinguishable', () => {
    const london = resolveFor({ city: 'london' });
    const dublin = resolveFor({ city: 'dublin' });
    // shared british substrate
    expect(london.subsystems.windows.sash.weight).toBeGreaterThan(0);
    expect(dublin.subsystems.windows.sash.weight).toBeGreaterThan(0);
    // but dublin's coloured door is its own
    expect(compatFor(dublin, 'details', 'coloured_door')).toBe('preferred');
    expect(compatFor(london, 'details', 'coloured_door')).toBe('forbidden');
  });

  it('the same typology reads differently in three families', () => {
    const roofOf = (city: string) => chooseOne(resolveFor({ city, typology: 'cottage' }), 'roof', createRng('x'));
    const seen = new Set([roofOf('london'), roofOf('iceland'), roofOf('tokyo')]);
    // tokyo forbids nothing in common with london's gable vocabulary the same way —
    // at minimum the three must not collapse to a single roof form
    expect(seen.size).toBeGreaterThan(1);
  });
});

// --- sliders ---

describe('global sliders', () => {
  const ornament = getLayer(lib, 'slider', 'ornament');

  it('turning ornament up raises the density range and the detail weights', () => {
    const plain = resolveFor(LONDON_TOWNHOUSE, [{ layer: ornament, value: 0 }]);
    const ornate = resolveFor(LONDON_TOWNHOUSE, [{ layer: ornament, value: 1 }]);
    expect(ornate.subsystems.ornament.density.range![1]).toBeGreaterThan(plain.subsystems.ornament.density.range![1]);
    expect(ornate.subsystems.details.cornice.weight).toBeGreaterThan(plain.subsystems.details.cornice.weight);
  });

  it('a slider can never resurrect a forbidden key', () => {
    // paris forbids the fire escape outright; ornament at full does not care
    const r = resolveFor({ city: 'paris' }, [{ layer: ornament, value: 1 }]);
    expect(r.subsystems.details.fire_escape.weight).toBe(0);
    expect(compatFor(r, 'details', 'fire_escape')).toBe('forbidden');
  });

  it('a slider keeps its range inside what the categorical layers permitted', () => {
    const r = resolveFor(LONDON_TOWNHOUSE, [{ layer: ornament, value: 1 }]);
    const [lo, hi] = r.subsystems.ornament.density.range!;
    expect(lo).toBeGreaterThanOrEqual(0.2); // townhouse floor
    expect(hi).toBeLessThanOrEqual(0.9); // townhouse ceiling
  });

  it('records itself in the stack so a building knows why it looks like that', () => {
    const r = resolveFor(LONDON_TOWNHOUSE, [{ layer: ornament, value: 0.8 }]);
    expect(r.stack).toContain('slider:ornament');
    expect(r.subsystems.details.cornice.sources).toContain('slider:ornament');
  });
});

// --- sampling: seeded and reproducible ---

describe('seeded sampling', () => {
  const r = resolveFor(LONDON_TOWNHOUSE);

  it('same seed + same stack = the same building, byte for byte', () => {
    expect(JSON.stringify(sampleBuilding(r, 'seed-a'))).toBe(JSON.stringify(sampleBuilding(r, 'seed-a')));
  });

  it('different seeds give different buildings', () => {
    const shapes = new Set(
      Array.from({ length: 30 }, (_, i) => JSON.stringify(sampleBuilding(r, `seed-${i}`)))
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('a required key is the answer, not merely likely', () => {
    const nyc = resolveFor({ city: 'new_york', typology: 'tenement' });
    for (const req of requiredKeys(nyc, 'details')) {
      for (let i = 0; i < 50; i++) expect(sampleBuilding(nyc, `s${i}`).details).toContain(req.key);
    }
  });

  it('weighted choice honours the weights', () => {
    const entries = candidates(resolveFor({ city: 'new_york' }), 'roof');
    const counts = new Map<string, number>();
    const rng = createRng('distribution');
    for (let i = 0; i < 3000; i++) {
      const key = pickWeighted(rng, entries)!.key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // flat is nyc's dominant roof; it must beat the uncommon gable by a wide margin
    expect(counts.get('flat')!).toBeGreaterThan((counts.get('gable') ?? 0) * 5);
  });

  it('every sampled key is one the stack actually permits', () => {
    for (let i = 0; i < 60; i++) {
      const b = sampleBuilding(r, `check-${i}`);
      for (const key of b.details) expect(r.subsystems.details[key].weight).toBeGreaterThan(0);
      if (b.roof.form) expect(r.subsystems.roof[b.roof.form].weight).toBeGreaterThan(0);
      expect(b.massing.floors).toBeGreaterThanOrEqual(r.subsystems.massing.floors.range![0]);
      expect(b.massing.floors).toBeLessThanOrEqual(r.subsystems.massing.floors.range![1]);
    }
  });
});

// --- THE INVARIANT ---

describe('the falsifier: switching a style layer is a bounded diff, not a regeneration', () => {
  const londonStack = resolveFor(LONDON_TOWNHOUSE);
  const nycStack = resolveFor({ city: 'new_york', typology: 'townhouse', era: 'victorian' });

  const base: BuildingRecipe = sampleBuilding(londonStack, 'kings-road-14');

  it('set_city keeps the seed — a switch is not a re-roll', () => {
    const { recipe } = switchStack(base, nycStack);
    expect(recipe.seed).toBe(base.seed);
  });

  it('set_city changes only what the new stack actually objects to', () => {
    const { recipe, changes } = switchStack(base, nycStack);
    for (const change of edits(changes)) {
      if (change.kind === 'swap') {
        // a swap is only legal because the old value became forbidden
        const [subsystem] = change.path.split('.');
        const bucket = subsystem === 'typology' ? 'typologies' : subsystem === 'facade' ? 'facade' : subsystem;
        expect(nycStack.subsystems[bucket]?.[String(change.from)]?.weight ?? 0).toBe(0);
      }
      if (change.kind === 'drop') expect(recipe.details).not.toContain(change.from);
    }
  });

  it('a value the new city is happy with is left completely alone', () => {
    const { recipe, changes } = switchStack(base, nycStack);
    const untouched = changes.filter((c) => c.kind === 'keep');
    expect(untouched.length).toBeGreaterThan(0);
    if (nycStack.subsystems.roof[String(base.roof.form)]?.weight > 0) {
      expect(recipe.roof.form).toBe(base.roof.form);
    }
  });

  it('the switch is deterministic — same input, same diff, every time', () => {
    const a = switchStack(base, nycStack);
    const b = switchStack(base, nycStack);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a switch never introduces something the new stack forbids', () => {
    const { recipe } = switchStack(base, nycStack);
    for (const key of recipe.details) expect(nycStack.subsystems.details[key].weight).toBeGreaterThan(0);
    for (const key of recipe.ground.features) expect(nycStack.subsystems.ground[key].weight).toBeGreaterThan(0);
    expect(recipe.ground.features).not.toContain('front_garden');
  });

  it('a switch always introduces what the new stack requires', () => {
    const { recipe } = switchStack(base, nycStack);
    for (const req of requiredKeys(nycStack, 'details')) expect(recipe.details).toContain(req.key);
  });

  it('numbers are clamped the minimum distance, never resampled', () => {
    const cottage = sampleBuilding(resolveFor({ city: 'london', typology: 'cottage' }), 'lane-end');
    const asApartment = resolveFor({ city: 'london', typology: 'apartment' });
    const { recipe, changes } = switchStack(cottage, asApartment);
    const [lo] = asApartment.subsystems.massing.floors.range!;
    expect(recipe.massing.floors).toBe(lo); // clamped to the nearest legal value
    expect(changes.find((c) => c.path === 'massing.floors')?.kind).toBe('clamp');
  });

  it('switching back restores everything the two stacks agree on', () => {
    const there = switchStack(base, nycStack).recipe;
    const back = switchStack(there, londonStack).recipe;
    // london is happy with everything london generated, so the round trip is stable
    // for every field nyc did not have to overwrite
    expect(back.massing.floors).toBe(base.massing.floors);
    expect(back.typology).toBe(base.typology);
    expect(back.seed).toBe(base.seed);
  });

  it('a switch is cheaper than a regeneration — it touches a bounded slice', () => {
    const { changes } = switchStack(base, nycStack);
    const changed = edits(changes).length;
    expect(changed).toBeGreaterThan(0); // london -> new york must do *something*
    expect(changed).toBeLessThan(changes.length); // but never everything
  });

  it('every reported conflict carries the layers that caused it', () => {
    const r = resolveFor({ city: 'new_york', typology: 'cottage' });
    for (const c of r.conflicts) {
      expect(c.layers.length).toBeGreaterThan(0);
      expect(c.detail).toBeTruthy();
    }
  });
});

// --- the bundle the app actually ships ---

describe('portability', () => {
  it('the whole rules/ directory loads as one plain bundle', () => {
    const bundle = readBundle();
    const library = rulesLibrary();
    const count = Object.values(bundle).reduce((n, tables) => n + Object.keys(tables ?? {}).length, 0);
    expect(library.size).toBe(count);
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('a full stack resolves with no unexpected conflicts', () => {
    const r = resolveFor({ city: 'new_york', typology: 'brownstone', era: 'italianate', condition: 'lived_in' });
    expect(r.conflicts).toEqual([]);
    expect(forbiddenKeys(r, 'ground').map((e) => e.key)).toContain('front_garden');
    expect(r.stack).toEqual([
      'family:north_american_urban',
      'city:new_york',
      'era:italianate',
      'typology:brownstone',
      'condition:lived_in',
    ]);
  });
});

// --- vocabulary hygiene: found by actually running scripts/street.ts ---

describe('subsystem hygiene', () => {
  // running the street printer produced "roof: dormers" — a dormer is a thing that
  // sits ON a roof, not a roof shape. chooseOne('roof') picks exactly one form, so
  // accessories and cladding materials must live in their own subsystems or the
  // generator will happily build a house whose roof is a chimney.
  const ACCESSORIES = ['dormer', 'dormers', 'chimney', 'cupola', 'weather_vane', 'water_tank', 'skylight', 'roof_terrace'];
  const MATERIALS = ['slate', 'red_tile', 'clay_tile', 'metal_roof', 'zinc', 'terracotta', 'tar', 'asphalt_shingle'];

  it('no roof-form table contains an accessory or a cladding material', () => {
    const offenders: string[] = [];
    for (const [dir, kind] of Object.entries(DIR_KINDS)) {
      for (const [id, raw] of Object.entries(readTables(dir))) {
        for (const key of Object.keys(normalizeLayer(raw, kind, id).subsystems.roof ?? {})) {
          if (ACCESSORIES.includes(key)) offenders.push(`${dir}/${id}.json roof.${key} is an accessory`);
          if (MATERIALS.includes(key)) offenders.push(`${dir}/${id}.json roof.${key} is a material`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a sampled roof form is always a form', () => {
    for (const city of ['london', 'new_york', 'paris', 'tokyo', 'iceland']) {
      const r = resolveFor({ city });
      for (let i = 0; i < 25; i++) {
        const b = sampleBuilding(r, `${city}-${i}`);
        expect(ACCESSORIES).not.toContain(b.roof.form);
        expect(MATERIALS).not.toContain(b.roof.form);
      }
    }
  });

  it('every typology table is reachable from at least one city', () => {
    const referenced = new Set<string>();
    for (const id of Object.keys(readTables('cities'))) {
      for (const key of Object.keys(resolveFor({ city: id }).subsystems.typologies ?? {})) referenced.add(key);
    }
    const orphans = Object.keys(readTables('typologies')).filter((t) => !referenced.has(t));
    expect(orphans, `typology dna no city ever asks for: ${orphans.join(', ')}`).toEqual([]);
  });
});
