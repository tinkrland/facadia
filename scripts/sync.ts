// portable-backend sync. rules/ is the source of truth; this tool (a) bundles the
// tables into one portable artifact any host can serve, and (b) mirrors them onto
// a xano instance and proves the round trip with checksums.
//
//   npm run sync -- bundle      -> dist/rules-bundle.json (the portable backend artifact)
//   npm run sync -- push        -> POST every table to xano ($XANO_BASE/api:rules/upsert)
//   npm run sync -- verify      -> GET tables back, recompute checksums, diff must be zero
//
// env: XANO_BASE (instance root), XANO_JWT (auth token), XANO_GROUP (api group, default "rules")
// xano is a delivery vehicle — the app must run with xano unreachable (bundled rules).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/util/sha256';
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

export interface BundledTable {
  kind: LayerKind;
  id: string;
  sha: string; // sha256 of canonical body serialization — the identity of the table
  body: unknown;
}

/** canonical: key-sorted, stable serialization — checksums match regardless of authoring order */
function canonical(body: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sort(x)]))
    : v;
  return JSON.stringify(sort(body));
}

/** every table under rules/, each with its checksum. */
export function collect(): BundledTable[] {
  const tables: BundledTable[] = [];
  for (const [dir, kind] of Object.entries(DIRS)) {
    for (const file of readdirSync(join(RULES, dir))) {
      if (!file.endsWith('.json')) continue;
      const id = basename(file, '.json');
      const body = JSON.parse(readFileSync(join(RULES, dir, file), 'utf8'));
      tables.push({ kind, id, sha: sha256Hex(canonical(body)), body });
    }
  }
  return tables;
}

export function bundlePath(): string {
  return fileURLToPath(new URL('../dist', import.meta.url));
}

/** emit dist/rules-bundle.json — one file, every table, self-checksummed. */
export function writeBundle(tables: BundledTable[]): string {
  const dir = bundlePath();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'rules-bundle.json');
  const checksum = sha256Hex(tables.map((t) => t.sha).sort().join(''));
  writeFileSync(
    path,
    JSON.stringify({ version: new Date().toISOString().slice(0, 10), checksum, tables }, null, 2)
  );
  return path;
}

// ---------------------------------------------------------------------------
// xano mirror. endpoints this expects (create once in the xano UI — see rules/adapters/xano.md):
//   GET  {XANO_BASE}/api:<group>/all    -> { tables: [{ id, kind, sha, body }] }
//   POST {XANO_BASE}/api:<group>/upsert body { id, kind, sha, body } -> { ok: true }
// ---------------------------------------------------------------------------

function xanoEnv() {
  const base = process.env.XANO_BASE ?? '';
  const jwt = process.env.XANO_JWT ?? process.env.JWT_TOKEN ?? '';
  const group = process.env.XANO_GROUP ?? 'rules';
  if (!base || !jwt) {
    console.error('need XANO_BASE and XANO_JWT (or JWT_TOKEN) in env to talk to a xano instance.');
    console.error('bundle works offline: `npm run sync -- bundle`.');
    process.exit(1);
  }
  return { base: base.replace(/\/$/, ''), jwt, group };
}

async function call<T>(path: string, jwt: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
  return (await res.json()) as T;
}

/** push every table, then verify the round trip. zero-diff or it reports loudly. */
export async function push(): Promise<void> {
  const { base, jwt, group } = xanoEnv();
  const tables = collect();
  let pushed = 0;
  for (const t of tables) {
    await call(`${base}/api:${group}/upsert`, jwt, {
      method: 'POST',
      body: JSON.stringify(t),
    });
    pushed++;
  }
  console.log(`pushed ${pushed} tables to ${base}/api:${group}/`);
  await verify();
}

/** GET everything back, recompute checksums, and demand a zero diff. */
export async function verify(): Promise<void> {
  const { base, jwt, group } = xanoEnv();
  const remote = (await call<{ tables: BundledTable[] }>(`${base}/api:${group}/all`, jwt)).tables ?? [];
  const local = new Map(collect().map((t) => [`${t.kind}:${t.id}`, t]));
  const seen = new Set<string>();
  let ok = 0;
  const problems: string[] = [];
  for (const t of remote) {
    const key = `${t.kind}:${t.id}`;
    seen.add(key);
    const mine = local.get(key);
    if (!mine) problems.push(`remote-only: ${key} (stale on xano — delete it there)`);
    else if (mine.sha !== t.sha) problems.push(`checksum mismatch: ${key}`);
    else ok++;
  }
  for (const key of local.keys()) if (!seen.has(key)) problems.push(`local-only: ${key} (not pushed yet)`);
  console.log(`verify: ${ok} ok, ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  ! ${p}`);
  if (problems.length) process.exit(1);
}

const cmd = process.argv[2];
if (cmd === 'bundle') {
  const tables = collect();
  const path = writeBundle(tables);
  const checksum = sha256Hex(tables.map((t) => t.sha).sort().join(''));
  console.log(`bundled ${tables.length} tables -> ${path}`);
  console.log(`bundle checksum: ${checksum}`);
} else if (cmd === 'push') {
  await push();
} else if (cmd === 'verify') {
  await verify();
} else {
  console.log('usage: npm run sync -- bundle | push | verify');
}
