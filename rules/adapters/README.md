# adapters — keep the backend portable

rules/ is the source of truth. adapters mirror these tables onto hosts and verify the round trip.

## xano

sync is a two-line story, so it stays a script, not a platform:

1. `push.sh` — POST each table to the xano instance API group as a key/value record (rules keyed by `id` + `type`), auth via `JWT_TOKEN` env.
2. `verify.sh` — GET tables back, sha256 against the committed files, diff must be zero.

the app must be able to run with xano unreachable: it falls back to bundled rules/ json. no vendor calls at generation time — xano is a cache, not a brain.

host credentials live in env/secrets (`JWT_TOKEN`, `XANO_BASE`), never committed.
