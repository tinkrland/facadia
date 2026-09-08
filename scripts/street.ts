// sample a street from the committed rule tables, and show a style switch as a diff.
//
//   npm run street                                  -- london, victorian, 6 buildings
//   npm run street -- --city new_york --era italianate --n 8
//   npm run street -- --city london --switch new_york
//
// this is a reviewer's tool: it prints recipes, not pictures. the point is to be able
// to read what the rule tables decided and see that a switch touches a bounded slice.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, expandStack, getLayer, type RawLayer } from '../src/rules/load';
import { resolve, type SliderBinding } from '../src/rules/resolve';
import { createRng, pickWeighted, sampleBuilding } from '../src/rules/sample';
import { edits, switchStack } from '../src/rules/diff';
import type { LayerKind } from '../src/rules/types';

const RULES = fileURLToPath(new URL('../rules', import.meta.url));
const DIRS: Record<string, LayerKind> = {
  families: 'family',
  cities: 'city',
  eras: 'era',
  typologies: 'typology',
  conditions: 'condition',
  sliders: 'slider',
};

function bundle() {
  const out: Partial<Record<LayerKind, Record<string, RawLayer>>> = {};
  for (const [dir, kind] of Object.entries(DIRS)) {
    const tables: Record<string, RawLayer> = {};
    for (const file of readdirSync(join(RULES, dir))) {
      if (file.endsWith('.json')) tables[basename(file, '.json')] = JSON.parse(readFileSync(join(RULES, dir, file), 'utf8'));
    }
    out[kind] = tables;
  }
  return out;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const lib = loadLibrary(bundle());
const city = arg('city', 'london')!;
const era = arg('era', 'victorian');
const condition = arg('condition');
const n = Number(arg('n', '6'));
const seed = arg('seed', 'street-1')!;
const target = arg('switch');

// a street mixes typologies by the city's own weights, which is what the typology
// table in a city layer is for.
const cityOnly = resolve(expandStack(lib, { city }));
const preferred = Object.values(cityOnly.subsystems.typologies ?? {}).filter((e) => e.weight > 0);

// a city may prefer a typology that has no dna table written yet. that is a real gap,
// so say which ones rather than crashing or silently building them from nothing.
const typologies = preferred.filter((e) => lib.has(`typology:${e.key}`));
const undefined_ = preferred.filter((e) => !lib.has(`typology:${e.key}`)).map((e) => e.key);

const sliders: SliderBinding[] = [];
for (const id of ['ornament', 'storybook', 'density']) {
  const v = arg(id);
  if (v !== undefined) sliders.push({ layer: getLayer(lib, 'slider', id), value: Number(v) });
}

function stackFor(cityId: string, typology: string) {
  return resolve(
    expandStack(lib, { city: cityId, era, typology, ...(condition ? { condition } : {}) } as Partial<Record<LayerKind, string>>),
    sliders
  );
}

console.log(`\n${city}${era ? ` · ${era}` : ''}${condition ? ` · ${condition}` : ''} — ${n} buildings, seed "${seed}"\n`);
if (undefined_.length) console.log(`  (no dna table yet: ${undefined_.join(', ')})\n`);

for (let i = 0; i < n; i++) {
  // pick a typology by the city's own weights, from the same seeded stream as everything else
  const chosen = pickWeighted(createRng(`${seed}/typology/${i}`), typologies) ?? typologies[0];

  const r = stackFor(city, chosen.key);
  const b = sampleBuilding(r, `${seed}/${i}`);

  console.log(
    `  ${String(i + 1).padStart(2)}. ${b.typology?.padEnd(20)} ${String(b.massing.floors)}f  ` +
      `roof:${b.roof.form ?? '-'}/${b.roof.material ?? '-'}  facade:${b.facade.material ?? '-'}  windows:${b.windows.style ?? '-'}`
  );
  console.log(`      details: ${b.details.join(', ') || '-'}`);
  if (b.conflicts.length) console.log(`      ! ${b.conflicts.join('\n      ! ')}`);

  if (target && i === 0) {
    const next = stackFor(target, chosen.key);
    const { changes } = switchStack(b, next);
    const changed = edits(changes);
    console.log(`\n      set_city ${city} -> ${target}: ${changed.length} change(s) of ${changes.length} fields`);
    for (const c of changed) console.log(`        ${c.kind.padEnd(5)} ${c.path}: ${c.from} -> ${c.to}   (${c.why})`);
    console.log('');
  }
}
console.log('');
