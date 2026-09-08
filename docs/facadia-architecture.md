# facadia — architecture as the constraint graph

the shelf proved the thesis: a node keeps its identity, edits are checked ops, views are projections. facadia applies the same thesis to buildings — and adds the layer svgery deliberately didn't have: **style layers.** typology, city, era, condition are not nodes and not code. they are rule tables that parameterize ops and constrain the graph. switching one is one op with bounded effects. it is not a regeneration.

this doc defines: the role vocabulary, the style-layer model, the compatibility schema, and the new ops.

---

## 1. the building graph

same atom as the shelf, new vocabulary. a building is a tree of local frames:

```
building.london_rd.14            role: building
├── mass                        role: mass
├── roof                        role: roof            (or roof.mansard, role: roof, attrs: {form: mansard})
├── facade                      role: facade          (attrs: material, bond, paint)
│   └── floor.1 … floor.N       role: floor
│       └── window.1 … window.M role: window          (attrs: style, panes, state)
│   └── entrance                role: entrance        (attrs: door type, recessed, steps)
├── cornice                     role: ornament        (attrs: density)
├── chimney.1                   role: chimney
├── fire_escape                 role: escape          (attrs: levels, rail style)   ← nyc dna
├── stoop                       role: ground          (attrs: steps, railing)
└── ground                      role: ground          (setback, verge, garden)
```

- ids are addresses: `london_rd.14.floor.2.window.3` is that window forever. switch city, it's still that window — maybe sash now, maybe arched — but the id, the hand-dragged offset a user gave it, and its window box survive.
- floors, windows, chimneys are inserted/removed like tiers — same `insert`/`tombstone` mechanics, respacing via ratio locks (`floor.*.h / mass.h` within range), fresh suffix ids, no renumbering.
- roles are extendable strings, exactly like svgery. new vocabulary (dormer, oriel, awning, noren) is data, not code.

## 2. style layers (the new part)

the architecture system's 13 subsystems (typology, massing, roof, facade, openings, vertical elements, ornament, materials, ground interface, attachments, utilities, vegetation, condition) split into two kinds of thing:

**graph-side** (physical, node-shaped): massing dims, floor count, window count, roof form, materials, attachments. these are nodes/attrs.

**rule-side** (cultural, table-shaped): *which* roof forms a city permits, *how* ornamented an era is, *what* a typology demands. these live in style layers — plain JSON, versioned in `rules/`, never hard-coded.

a style layer is a set of keyed parameters, each carrying a **compatibility weight**:

```
0      forbidden   — op rejected by the checker. not that kind of thing.
0.15   uncommon    — allowed, rarely sampled
1      allowed     — baseline
4      preferred   — sampled strongly
req    required    — auto-inserted if missing, cannot be removed while layer is active
```

layers stack, and the effective weight of any value is the product of the active layers (city × era × typology × condition × global sliders). sampling is seeded — same seed + same layers = same building. deterministic, no llm inside.

## 3. the new ops

surgical, checked, logged — same shape as the canonical six:

| op | target | bounded effects |
|---|---|---|
| `set_typology` | building | may re-mass (floors insert/tombstone via ratio locks), re-ground (stoop ↔ garden swap). never touches facade identity nodes; attrs change, ids don't. |
| `set_city` | building | walks each subsystem, diffs old city table vs new, emits set-attr ops only where weights changed. windows restyle in place; mass untouched; hand-edited frames keep their offsets unless a ratio now fails. |
| `set_era` | building | ornament density, materials vocabulary, window styles — same diff-walk. |
| `set_condition` | building | per-subsystem condition marks (moss, boarded windows, peeling paint) as attrs + ornament density shifts. |
| `set_slider` | building | one global slider (ornament, symmetry, verticality, storybook, …) — multiplies weights, then diff-walk. |
| `insert_floor` / `insert_window` / `insert_chimney` | floor / facade / roof | tier mechanics, general. |
| `set_window_state` | window | lit / dark / curtains / silhouette — the nocturne views night-mode primitive. |

the invariant that makes this facadia (stated as a test):

> **switching one style layer is ONE op with bounded, diff-derived effects.** the building keeps its id, its floor count (unless the new typology's ratio lock forbids it and the op must re-mass — and then only the minimum nodes change), its hand-edits, and its seed. if set_city rebuilds the street, facadia has failed exactly the way svgery refuses to.

the diff-walk is pure: `(graph, old_layers, new_layers) → [set-attr | set-frame | insert | tombstone effects]`. nothing stochastic inside a switch. randomness only enters at *generation time* (seeded sampling from the stacked tables), never at *switch time*.

## 4. provenance upgrade for hand edits

an effect emitted with `actor: "human"` (a drag on an anchor) outranks style layers: subsequent `set_city` / `set_era` diff-walks skip human-authored attrs/frames unless the incoming layer makes them violate a ratio lock — in which case the checker rejects the *switch*, it does not silently overwrite the human. the op log already distinguishes actors; this just gives the rule-side a way to respect it.

## 5. rule tables = the backend, portable

`rules/` in this repo is the source of truth. xano (or any host) is a *cache/delivery vehicle*, never the author.

```
rules/
├── schema.md          — the format (this doc §2, plus file layout)
├── typologies/        — building DNA: cottage.json, townhouse.json, brownstone.json, …
├── cities/            — london.json, new_york.json, amsterdam.json, tokyo.json, …
├── eras/              — victorian.json, georgian.json, art_deco.json, …
├── sliders/           — ornament, symmetry, density, verticality, storybook, …
└── adapters/          — sync scripts: pull rules → xano via REST, and verify round-trip
```

- every rule file is plain JSON, committed, reviewable, diffable — the "backend defines things" requirement, with the definition being *data you own*.
- the app consumes the same JSON whether it loads it from bundle, fetch, or xano. zero vendor calls at generation time.
- adapters are scripts (in-repo) that push the tables to xano and verify a checksum round-trip — so moving to any other host is a re-run of a script, not a migration.

## 6. phases

**f2 — vocabulary.** extend roles/ops; building fixture; tests: id stability under set_city, floor insert respacing, tombstoned windows.

**f3 — style layers + diff-walk.** rule schema; 2 typologies × 2 cities × 1 era; the switch-is-one-op test.

**f4 — compat engine.** weighted sampling, required-forbidden enforcement, era × condition. incompatibility table from the concept guide becomes plain JSON.

**f5 — nocturne integration.** window states, night mode as a view/projection, street composition (building nodes under a street graph), export of rules → xano adapter.

each phase lands with tests in the same spirit as phase 1: invariants as regression suite, replay as provenance.
