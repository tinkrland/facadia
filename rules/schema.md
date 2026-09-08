# rule tables — the portable backend

the source of truth. committed json, never hard-coded. any host (xano, bundle, cdn) is a delivery vehicle for these files, and `adapters/` keeps that true.

## file format

a rule table is a stackable layer. keys address graph subsystems; values carry weights:

- `forbid` — checker rejects ops touching this
- `weight: 0.15` — uncommon (allowed, rarely sampled)
- `weight: 1` — allowed baseline
- `weight: 4` — preferred (sampled strongly)
- `require: true` — auto-inserted, cannot be removed while layer is active

effective weight = product of all active layers. sampling is seeded (deterministic).
switching a layer never samples — it diff-walks (see docs/facadia-architecture.md §3).

## files

- `typologies/*.json` — building dna: massing ranges, floors, setback, attachments
- `cities/*.json` — regional vocabulary: roofs, windows, materials, details, ground interface
- `eras/*.json` — ornament, styles, materials of a period
- `adapters/` — sync to/from hosts + round-trip checksum verify
