# supabase mirror — setup (once, ~2 minutes in the SQL editor)

the engine's rules are committed json (`rules/`). supabase serves them as a **cache** —
`npm run sync -- push` mirrors every table and `verify` proves the round trip with
checksums. the app must also run fully offline on the bundled tables
(`npm run sync -- bundle` -> `dist/rules-bundle.json`), so supabase is never a
dependency, only a delivery vehicle. PostgREST exposes the table automatically —
there are no endpoints to author (that was the xano tax; we migrated off it).

## env

| var | value |
|---|---|
| `SUPABASE_URL` | project root, e.g. `https://xyzcompany.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key — bypasses RLS. never ship this client-side; the frontend reads via the `anon` key + a read policy below |

## 1. create the table (SQL editor, once)

```sql
create table if not exists public.rule_tables (
  id   text primary key,          -- "kind:id", e.g. 'city:london'
  kind text not null,
  name text not null,
  sha  text not null,             -- sha256 of the canonical body json
  body jsonb not null,
  updated_at timestamptz not null default now()
);
```

## 2. let the anon key read (so the app can fetch without the service key)

```sql
alter table public.rule_tables enable row level security;
create policy "rules are world-readable"
  on public.rule_tables for select
  to anon, authenticated
  using (true);
```

writes stay service-role only (no insert/update policy = RLS blocks them).

## 3. mirror + prove

```bash
export SUPABASE_URL=… SUPABASE_SERVICE_KEY=…
npm run sync -- push     # upserts every table, then verifies automatically
npm run sync -- verify   # re-check any time; zero-diff or it fails loudly
```

`verify` compares sha256 of the canonical body json (key-sorted), so authoring
key order can never cause a false mismatch. remote-only rows are reported as
stale — delete them in supabase after removing a table locally:

```sql
delete from public.rule_tables where id not in (…); -- or just truncate + push
```
