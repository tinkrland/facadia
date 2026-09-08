# rule tables — the portable backend

the source of truth. committed json, never hard-coded. any host (xano, bundle, cdn) is a delivery vehicle for these files, and `adapters/` keeps that true.

the engine that reads them is `src/rules/` — zero runtime deps, pure, no llm inside.

## file format

a rule table is a stackable layer. every key that is not metadata is a **subsystem**; inside a subsystem, each key carries an **entry**:

```json
{
  "id": "london",
  "extends": ["british"],
  "roof": { "gable": { "weight": 4 }, "sawtooth": { "forbid": true } },
  "massing": { "floors": { "range": [2, 4] } }
}
```

metadata keys: `id`, `kind`, `extends`, `effects`, `default`, `$comment`, `$schema`. the file's basename must equal its `id` — that is the address the loader indexes by.

### entries

| field | meaning |
|---|---|
| `weight: 0.15` | uncommon — allowed, rarely sampled |
| `weight: 1` | allowed — the baseline |
| `weight: 3` | common |
| `weight: 4` | preferred — sampled strongly |
| `forbid: true` | **absorbing.** not that kind of thing. nothing resurrects it |
| `require: true` | auto-inserted, cannot be removed while the layer is active |
| `range: [lo, hi]` | numeric bounds (floors, width, ornament density) |

a single entry may not both `forbid` and `require` — the loader rejects it.

### the three resolution rules

1. **weights multiply.** `london × victorian × townhouse`. a layer that is silent about a key does not vote on it.
2. **forbid is absorbing.** any layer forbidding a key collapses it to 0, and 0 times anything is still 0 — a slider at full tilt cannot bring it back.
3. **ranges intersect.** a cottage stays cottage-sized in manhattan. if the intersection is empty the layers genuinely disagree, so the resolver **reports a conflict** and defers to the highest-precedence layer rather than inventing a compromise nobody authored.

precedence (later wins a range conflict): `family < city < era < typology < condition < slider`. so a typology's dna outranks a city's on massing, which is what keeps a cottage a cottage.

**silence at the layer level is neutral; silence across the whole stack means the key is not in that vocabulary at all.** `details.brick_arches` exists in the british family and nowhere in new york, so a london building moved to new york loses its brick arches. that is the point — it is what makes london stop looking like new york.

### the five compatibility tiers

`forbidden · uncommon · allowed · preferred · required`, derived from the resolved weight plus the required flag (`compatOf` in `src/rules/types.ts`). every asset is not `allowed = true`; it is one of five.

## the layers

```
rules/
├── families/    — vernacular substrate: british, dutch, french, nordic,
│                  mediterranean, japanese, north_american_urban
├── cities/      — thin deltas over a family via `extends`
├── eras/        — victorian, italianate, second_empire
├── typologies/  — building dna: massing ranges, floors, setback, attachments
├── conditions/  — wear marks across every subsystem: new … abandoned
├── sliders/     — global modifiers: ornament, symmetry, verticality, density,
│                  age, uniformity, craft, storybook
└── adapters/    — sync to/from hosts + round-trip checksum verify
```

### families, and why cities are presets

there is no "london cottage asset" and no "london townhouse asset". `london` is a **delta over `british`**, and `british` carries the shared substrate — sash windows, brick, chimneys, iron railings. dublin is another delta over the same family, so the two share a vocabulary and still read as different cities (dublin's coloured door and fanlight are its own).

`extends` is **stack ordering, not a deep merge**: the family is pushed *beneath* the city, so the city's weights multiply on top and the family stays independently diffable. cycles are broken and each layer appears once.

### sliders

a slider is a global modifier with a value in `0..1`. it declares lerped effects:

```json
{ "id": "ornament", "kind": "slider", "default": 0.5,
  "effects": [
    { "target": "details.*", "at0": 0.2, "at1": 3.0 },
    { "target": "ornament.density", "rangeAt0": [0.0, 0.15], "rangeAt1": [0.6, 1.0] }
  ] }
```

`target` is `subsystem.key` and the key may glob (`*` or a prefix). weight effects lerp between `at0` and `at1`; range effects lerp both endpoints and are then clamped inside whatever the categorical layers already permitted. sliders apply *after* the categorical layers and record themselves in the resolution's provenance.

this is the concept guide's key move: the same london townhouse rules render as a minimal architectural illustration or a storybook town without a second rule system.

## subsystem vocabulary

keep these distinct — they are sampled differently:

| subsystem | sampled as | note |
|---|---|---|
| `typologies` | one | what kinds of building belong here. a selected typology layer **overrides** this |
| `massing` | ranges | `floors` (int), `width`, `verticality` (0..1) |
| `roof` | one | the **form** only: gable, hip, mansard, flat, stepped_gable … |
| `roof_material` | one | slate, clay_tile, zinc, tar … |
| `roof_accessories` | many | dormer, chimney, water_tank, cupola … |
| `facade` | one | the cladding material |
| `ornament` | range | `density` 0..1 |
| `windows` | one | the style |
| `entrance` | one | at_grade, stoop, recessed, arched … |
| `ground` | range + many | `setback` range, plus features |
| `details` | many | the personality layer |
| `attachments` | many | extension, conservatory, garage … |
| `vegetation` | many | ivy, window_box, moss … |
| `condition_marks` | many | condition layers only |

a roof form is a shape you can choose exactly one of; accessories sit **on** it and materials clad it. mixing them into `roof` lets the generator build a house whose roof is a chimney — there is a test that fails if a table does this.

## generation vs switching

- **generation samples.** seeded: same seed + same stack = the same building, byte for byte. every subsystem draws from its own substream, so adding a subsystem later does not reshuffle the ones already sampled.
- **switching a layer never samples.** it diff-walks two resolutions and emits only `keep · swap · drop · add · clamp`. there is no sixth verb. see `src/rules/diff.ts` and docs/facadia-architecture.md §3.

## known gaps

- **cross-subsystem compatibility is not modelled yet.** compat is per-key within a subsystem, so the resolver can pair a `flat` roof with `asphalt_shingle`, which needs pitch. relationships *between* subsystems (form × material, typology × entrance) are the next layer of the compat engine.
- several typologies referenced by city tables have no dna file yet (`semi_detached`, `pub`, `mews`, `council_house`, `victorian_apartment`, …). `npm run street` prints the current list.
- non-western vocabulary (machiya, hanok, amsterdam gable subtypes) is sourced from the concept guide only and has **not** been cross-checked against a preservation-glossary-equivalent source the way nyc was. see docs/architectural-vocabulary-research.md.

## reading the tables

```
npm test                                          # 41 rule tests
npm run street                                    # london, victorian
npm run street -- --city new_york --era italianate
npm run street -- --city london --switch new_york # print the diff a set_city emits
npm run street -- --city london --ornament 1 --storybook 1
```
