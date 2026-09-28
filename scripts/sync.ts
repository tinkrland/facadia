// portable-backend sync. rules/ is the source of truth; this tool (a) bundles the
// tables into one portable artifact any host can serve, and (b) mirrors them onto
// a supabase instance and proves the round trip with checksums.
//
//   npm run sync -- bundle      -> dist/rules-bundle.json (the portable backend artifact)
//   npm run sync -- push        -> upsert every table to supabase ($SUPABASE_URL/rest/v1/rule_tables)
//   npm run sync -- verify      -> GET tables back, recompute checksums, diff must be zero
//
// env: SUPABASE_URL (project root, e.g. https://xyz.supabase.co), SUPABASE_SERVICE_KEY
// (service role key — bypasses RLS; never expose it client-side).
// supabase is a delivery vehicle — the app must run with supabase unreachable (bundled rules).

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
// supabase mirror (PostgREST — no endpoints to author, the table IS the API):
//   POST {SUPABASE_URL}/rest/v1/rule_tables   body: row array, Prefer: resolution=merge-duplicates
//   GET  {SUPABASE_URL}/rest/v1/rule_tables?select=kind,id,sha,body
// table DDL lives in rules/adapters/supabase.md — run once in the SQL editor.
// ---------------------------------------------------------------------------

function supabaseEnv() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_KEY ?? '';
  if (!url || !key) {
    console.error('need SUPABASE_URL and SUPABASE_SERVICE_KEY in env to talk to a supabase project.');
    console.error('bundle works offline: `npm run sync -- bundle`.');
    process.exit(1);
  }
  return { root: url.replace(/\/$/, ''), key };
}

async function call<T>(url: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** row shape in supabase: primary key is "kind:id" so the same table never splits. */
function row(t: BundledTable) {
  return { id: `${t.kind}:${t.id}`, kind: t.kind, name: t.id, sha: t.sha, body: t.body };
}

/** push every table, then verify the round trip. zero-diff or it reports loudly. */
export async function push(): Promise<void> {
  const { root, key } = supabaseEnv();
  const tables = collect();
  const rows = tables.map(row);
  // one array upsert; PostgREST handles it atomically-ish per row via merge-duplicates
  await call(`${root}/rest/v1/rule_tables`, key, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  console.log(`pushed ${rows.length} tables to ${root}/rest/v1/rule_tables`);
  await verify();
}

/** GET everything back, recompute checksums, and demand a zero diff. */
export async function verify(): Promise<void> {
  const { root, key } = supabaseEnv();
  const params = new URLSearchParams({ select: 'kind,name,sha,body' });
  const remote: Array<{ kind: string; name: string; sha: string; body: unknown }> =
    await call(`${root}/rest/v1/rule_tables?${params}`, key);
  const local = new Map(collect().map((t) => [`${t.kind}:${t.id}`, t]));
  const seen = new Set<string>();
  let ok = 0;
  const problems: string[] = [];
  for (const t of remote) {
    const key2 = `${t.kind}:${t.name}`;
    seen.add(key2);
    const mine = local.get(key2);
    if (!mine) problems.push(`remote-only: ${key2} (stale in supabase — delete it there)`);
    else if (mine.sha !== t.sha) problems.push(`checksum mismatch: ${key2}`);
    else ok++;
  }
  for (const key2 of local.keys()) if (!seen.has(key2)) problems.push(`local-only: ${key2} (not pushed yet)`);
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
