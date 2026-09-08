// load the committed rule tables off disk for the tests.
//
// the engine itself stays dependency-free and platform-neutral: it consumes a
// plain bundle object, so the app can hand it bundled json, a fetch response, or
// a xano payload. this fixture is the node-side way to produce that bundle.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, type LayerLibrary, type RawLayer } from '../src/rules/load';
import type { LayerKind } from '../src/rules/types';

const RULES_DIR = fileURLToPath(new URL('../rules', import.meta.url));

/** directory name -> layer kind. */
const DIRS: Record<string, LayerKind> = {
  families: 'family',
  cities: 'city',
  eras: 'era',
  typologies: 'typology',
  conditions: 'condition',
  sliders: 'slider',
};

export function readTables(dir: string): Record<string, RawLayer> {
  const path = join(RULES_DIR, dir);
  const out: Record<string, RawLayer> = {};
  for (const file of readdirSync(path)) {
    if (!file.endsWith('.json')) continue;
    out[basename(file, '.json')] = JSON.parse(readFileSync(join(path, file), 'utf8')) as RawLayer;
  }
  return out;
}

export function readBundle(): Partial<Record<LayerKind, Record<string, RawLayer>>> {
  const bundle: Partial<Record<LayerKind, Record<string, RawLayer>>> = {};
  for (const [dir, kind] of Object.entries(DIRS)) bundle[kind] = readTables(dir);
  return bundle;
}

export function rulesLibrary(): LayerLibrary {
  return loadLibrary(readBundle());
}

export const DIR_KINDS = DIRS;
