# xano mirror — setup (once, ~5 minutes in the xano UI)

the engine's rules are committed json (`rules/`). xano serves them as a **cache** —
`npm run sync -- push` mirrors every table to your instance and `verify` proves the
round trip with checksums. the app must also run fully offline on the bundled
tables (`npm run sync -- bundle` -> `dist/rules-bundle.json`), so xano is never a
dependency, only a delivery vehicle. moving to any other host = re-point two env
vars and re-run push.

## env

| var | value |
|---|---|
| `XANO_BASE` | instance root, e.g. `https://xpnx-….z7.xano.io` |
| `XANO_JWT` | auth token (or `JWT_TOKEN`) |
| `XANO_GROUP` | api group name, default `rules` |

## 1. create the table

database -> add table `rule_tables`, columns:

- `id` text (unique) — e.g. `city:london`
- `kind` text
- `sha` text — checksum the verify step recomputes
- `body` json

add a unique constraint on `id` so upserts are idempotent.

## 2. create the api group + endpoints

api -> new api group `rules`, then:

- **`GET /all`** — function: query rule_tables (all), return `{ tables: [...] }`
- **`POST /upsert`** — function: input `{ id, kind, sha, body }`; upsert on `id`
  (find by id -> update, else create); return `{ ok: true }`

put your JWT auth on the group (auth header `Bearer`).

## 3. mirror + prove

```bash
export XANO_BASE=… XANO_JWT=…
npm run sync -- push     # pushes every table, then verifies automatically
npm run sync -- verify   # re-check any time; zero-diff or it fails loudly
```

`verify` compares sha256 of the canonical body json (key-sorted), so authoring
key order can never cause a false mismatch. remote-only rows are reported as
stale — delete them in xano after removing a table locally.
