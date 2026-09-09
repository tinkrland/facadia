---
name: facadia
description: >-
  How to extend the facadia procedural-facade engine WITHOUT breaking its thesis.
  Use when authoring or editing rule tables (families / cities / eras / typologies /
  conditions / sliders under rules/), touching the resolver / sampler / diff-walk in
  src/rules/, or wiring the recipe→SVG renderer (dom/, views/). Encodes the layer
  model, the three resolution rules, the five compatibility tiers, the five diff
  verbs, id-stability, hand-edit provenance, and the front-elevation render contract.
---

# facadia

facadia is **architecture encoded as a design language, not a menu of building types.** "a small london cottage" is a *query*, not an asset: the engine constructs a london-looking cottage by stacking rules. Nothing is hand-authored per city.

The load-bearing move: separate **what a building is** (typology DNA — cottage = small, 1–2 floors, gable, likely chimney, likely garden) from **how it expresses in a place** (london = sash windows, stock brick, brick arches, iron railings). `family < city < era < typology × condition × sliders` resolve into one **recipe**, which a renderer draws.

**The constraint graph / recipe is the product. The renderer is just the mouth.** If an edit can only be expressed as a fresh pile of paths, the system has failed.

---

## The three artifacts (know the boundaries)

1. **The engine — this repo (`tinkrland/facadia`).** Pure TypeScript, zero runtime deps, no LLM inside. Reads `rules/*.json`, resolves + samples + diff-walks. This is the source of truth.
2. **The base — `facadia.base44.app` ("Nocturne Views").** The live front-elevation night cityscape (interactive windows: lights, blinds, zoom-in). Proves the *aesthetic* and *interaction*. It is **not yet driven by this engine** — converging the two is the project.
3. **The vision — the "street generator" board.** Wizard (setting → city/family → era → building types → density → condition → personality → time → season → life) + a procedural parts library + mix/match swap.

**Render target is a FRONT-FACING ELEVATION — flat, no perspective, hand-inked, layered façades, cozy night palette, window storytelling.** It is NOT isometric/axonometric. (Iso lives in the furniture lineage — `views/` — and is out of scope for buildings.)

---

## The layer stack

Precedence (later wins a range conflict):

```
family < city < era < typology < condition < slider
```

- **family** is the vernacular substrate (british, dutch, french, nordic, mediterranean, japanese, north_american_urban): sash windows, brick, chimneys, iron railings.
- **city** is a **thin delta over a family via `extends`** — only what makes it itself. There is no "london cottage asset"; `london` extends `british`, `dublin` extends `british`, and they still read as different cities.
- `extends` is **stack ordering, NOT a deep merge.** The family is pushed *beneath* the city; the city's weights multiply on top; both stay independently diffable. Cycles are broken; each layer appears once.
- A file's basename **must equal its `id`** — that's the address the loader indexes by.

---

## The three resolution rules (do not add a fourth)

1. **Weights multiply.** `london × victorian × townhouse`. A layer silent about a key does not vote on it.
2. **`forbid` is absorbing.** Any layer forbidding a key collapses it to 0, and 0 × anything = 0. A slider at full tilt cannot resurrect it.
3. **Ranges intersect.** A cottage stays cottage-sized in Manhattan. If the intersection is empty the layers genuinely disagree → **report a conflict and defer to the highest-precedence layer. NEVER invent a compromise / average nobody authored.**

**Silence at the layer level is neutral. Silence across the whole stack means the key is not in that vocabulary at all** — e.g. `details.brick_arches` exists in `british` and nowhere in `new_york`, so a london building moved to new york *loses* its brick arches. That is the point; it's what makes london stop looking like new york. Do not "fix" this by back-filling vocabulary across families.

### Entry fields

| field | meaning |
|---|---|
| `weight: 0.15` | uncommon — allowed, rarely sampled |
| `weight: 1` | allowed — baseline |
| `weight: 3` | common |
| `weight: 4` | preferred — sampled strongly |
| `forbid: true` | absorbing; nothing resurrects it |
| `require: true` | auto-inserted, cannot be removed while the layer is active |
| `range: [lo, hi]` | numeric bounds (floors, width, ornament density) |

A single entry may **not** both `forbid` and `require` — the loader rejects it.

### The five compatibility tiers

`forbidden · uncommon · allowed · preferred · required`, derived from the resolved weight + the required flag (`compatOf` in `src/rules/types.ts`). **Every asset is one of five tiers — never a bare `allowed = true`.** This is what makes the output feel intelligent rather than random.

---

## Subsystem vocabulary (sampled differently — keep distinct)

| subsystem | sampled as | note |
|---|---|---|
| `typologies` | one | what kinds of building belong here; a selected typology layer overrides |
| `massing` | ranges | `floors` (int), `width`, `verticality` (0..1) |
| `roof` | one | the **form only**: gable, hip, mansard, flat, stepped_gable … |
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

**INVARIANT: never mix roof subsystems.** A roof *form* is a shape you pick exactly one of; accessories sit **on** it; material **clads** it. Putting accessories or materials into `roof` lets the generator build a house whose roof is a chimney. There is a test that fails if a table does this — keep it green.

---

## Generation vs switching (the core distinction)

- **Generation samples.** Seeded: same seed + same stack = the same building, **byte for byte.** Every subsystem draws from its **own substream**, so adding a subsystem later must **not** reshuffle the ones already sampled. Preserve substream isolation when you add a subsystem.
- **Switching a layer NEVER samples.** It diff-walks two resolutions and emits **only**:

```
keep · swap · drop · add · clamp
```

**There is no sixth verb, and none of them touch a fresh random stream.** Randomness enters at generation time only, never at switch time. (`src/rules/diff.ts`, architecture doc §3.)

---

## Identity invariants (the React-key rule, applied to drawings)

- **IDs are addresses; they are NEVER renumbered.** `london_rd.14.floor.2.window.3` is that window forever. Switch city and it's still that window — maybe sash now, maybe arched — but the id, the user's hand-dragged offset, and its window box survive.
- A node keeps its id across every edit. Floors / windows / chimneys insert & tombstone with **fresh suffix ids** — never a renumber.
- **The falsifier (state it as a test): switching one style layer is ONE op with bounded, diff-derived effects.** The building keeps its id, its floor count (unless the new typology's ratio lock forbids it and the op must re-mass — and then only the minimum nodes change), its hand-edits, and its seed. If `set_city` rebuilds the street, facadia has failed.

### Hand-edit provenance

An effect logged with `actor: "human"` **outranks style layers.** Subsequent `set_city` / `set_era` diff-walks **skip** human-authored attrs/frames — *unless* the incoming layer makes them violate a ratio lock, in which case the checker **rejects the switch**. It NEVER silently overwrites the human.

---

## Rendering contract (the recipe → SVG bridge)

The engine resolves a **recipe**. The renderer turns it into a front elevation. Rules for that mouth:

- **Front elevation only. No perspective.** Parts hang on a **bays × floors skeleton** placed by the engine's ratio locks — never absolute coordinates baked into a part.
- **rough.js is the renderer** (hand-inked line quality). Its `hachure` / `cross-hatch` / `dots` fills already cover weathering + shadow; window-light states give the nocturne look. Do **not** add a second hatching system.
- Each subsystem value (`windows: sash`, `roof: mansard`, `entrance: stoop`) is a **parametric SVG part = a function of params → component**, not a static asset.
- Window states `lit / dark / curtains / silhouette` are the nocturne night primitive — attr changes on the same node, not new nodes.
- The renderer is browser-only and lives in `dom/`. **It must never author identity** — the pure core owns the graph; the renderer only patches keyed elements. Keep the core browser-free and deterministic.

---

## Rules are data; the backend is portable

- `rules/` is the source of truth. Xano / bundle / CDN are **delivery vehicles only.** Zero vendor calls at generation time. `adapters/` pushes tables to a host and verifies a checksum round-trip.
- **The LLM may draft rule tables or suggest edits, but NEVER executes them.** Execution is deterministic code over the graph. That's what makes this surgery, not vibes.

---

## Playbook: how to add things

- **A new city:** create `rules/cities/<id>.json` with `extends: ["<family>"]` and **only the deltas** (what makes it itself). Basename = `id`. Never author a full building; never duplicate family vocabulary.
- **A new typology:** create `rules/typologies/<id>.json` with massing ranges, floors, setback, attachment tendencies — its DNA. Typology outranks city on massing (keeps a cottage a cottage).
- **A new slider:** `kind: "slider"`, `default` in `0..1`, `effects[]` where `target` is `subsystem.key` (globbable with `*` / prefix); weight effects lerp `at0→at1`; range effects lerp `rangeAt0→rangeAt1`, then clamp inside what categorical layers already permitted. Sliders apply *after* categorical layers and record themselves in provenance.
- **A new subsystem:** give it its own sampling substream so existing seeds don't reshuffle; decide one/range/many; add the compat + a regression test.

---

## Definition of done / guardrails

- `npm test` (rule tests) stays green. Eyeball with `npm run street` (and `--city`, `--era`, `--switch`, `--ornament`, `--storybook`).
- **New invariant → write the failing test first**, then satisfy it. Invariants-as-regression is the house style; the op log doubles as the suite.
- Hard "never"s: never add a sixth diff verb · never renumber ids · never mix roof subsystems · never average a range conflict · never let the renderer author identity · never sample inside a switch · never hard-code a rule that belongs in `rules/`.

---

## Known gaps (do not mistake these for bugs to blindly patch)

- **Cross-subsystem compatibility is not modelled yet.** Compat is per-key within one subsystem, so the resolver can still pair a `flat` roof with `asphalt_shingle` (which needs pitch). Relationships *between* subsystems (roof form × material, typology × entrance) are the next compat layer — model them deliberately, with tests.
- **Missing typology DNA:** `semi_detached`, `pub`, `mews`, `council_house`, `victorian_apartment` are referenced by city tables but have no DNA file. `npm run street` prints the current list.
- **Non-western vocabulary** (machiya, hanok, amsterdam gable subtypes) came from the concept guide only and has NOT been cross-checked against a preservation-glossary source the way NYC was (`docs/architectural-vocabulary-research.md`).

---

## Repo map

```
docs/    facadia-architecture.md · constraint-graph.md · research-background.md · architectural-vocabulary-research.md
rules/   schema.md · families/ · cities/ · eras/ · typologies/ · conditions/ · sliders/ · adapters/
src/     graph/ · check/ · apply/ · dom/ · views/ · log/ · rules/ (loader · resolver · sampler · diff)
test/    invariants as regression suite
scripts/ street.ts  →  npm run street
```
