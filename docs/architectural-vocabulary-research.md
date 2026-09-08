# architectural vocabulary — research notes (sourced)

grounding the taxonomy in real terminology before we encode more rule tables. sources: NYC Landmarks Preservation Commission glossary (nyc.gov/site/lpc/about/glossary.page), Pennsylvania Historical & Museum Commission dictionary of architectural terms, Cold Spring NY glossary of architectural terms, The Brownstone Boys field guide (Substack, 2026), Golan Team "10 Architectural Elements of a Brooklyn Brownstone".

this feeds `rules/cities/new_york.json` and new era layers below — it does not replace the concept-guide taxonomy, it verifies it against real preservation/real-estate terminology so facadia's vocabulary reads as "actually New York" and not generic townhouse.

## brownstone-specific vocabulary (confirmed real terms → role/attr candidates)

| term | what it is | facadia mapping |
|---|---|---|
| stoop | raised entrance stair to parlor floor, often 5-10 steps | `role: ground`, `attrs.stoop_steps` |
| parlor floor | the floor the stoop leads to (not ground floor) — tallest windows, most ornament | `role: floor`, `attrs.is_parlor: true` → ornament/window-height weight boost |
| brownstone (material) | Triassic/Jurassic sandstone facing, warm reddish-brown | `facade.material: "brownstone"` |
| Juliet balcony | decorative balcony rail with no floor/outdoor space, at a window | `role: ornament`, attaches to `window` node, no footprint |
| areaway | the sunken space/stair in front of the basement, below the stoop | `role: ground`, `attrs.areaway: true` |
| bracketed cornice | roofline cornice held up by scroll/block brackets — the Italianate tell | `role: ornament` under `roof`, `attrs.brackets: true` |
| parlor-floor French windows | full-height parlor windows, sometimes opening to a Juliet balcony | `window.style: "french"`, height ratio near 1.0 of floor height |

## roof/window/door vocabulary cross-check (general glossary terms already in our taxonomy, now confirmed standard)

confirmed as standard preservation-glossary terms, not invented: gable, hip, mansard, gambrel, saltbox, dutch gable (roof); sash, casement, hopper, awning, oriel, bow window (bow ≠ bay: bow is curved, bay is angled flat panels — worth encoding as a distinct window subtype, `window.style: "bow" | "bay"`), dormer; lintel, sill, quoin, string course, keystone, pilaster (ornament/trim — all present in our `ornament` vocabulary already).

**new subtype worth adding:** `bow` window as distinct from `bay` (curved vs. angled-flat) — glossaries consistently separate these; our original taxonomy only had "bay."

## era layers this unlocks (NYC brownstone chronology, from The Brownstone Boys field guide)

three eras that actually explain "why this brownstone looks different from that one," in build order:

1. **greek revival** (~1830s-1850s) — understated, flat lintels, simple doorway, minimal ornament, low/no stoop railing flourish
2. **italianate** (~1850s-1880s) — the "classic brownstone" everyone pictures: bracketed cornices, round-arched window tops, elaborate door hoods, high stoops
3. **second empire** (~1860s-1880s, overlapping italianate) — French influence, **mansard roof** (this is the direct historical reason mansard exists in our roof vocabulary at all), dormers, more vertical massing

added as `rules/eras/italianate.json` and `rules/eras/second_empire.json` alongside the existing `victorian.json` (victorian is the broader umbrella; these two are the specific NYC-relevant sub-periods our default city needs).

## rough.js note (rendering, not research — confirming the plan)

rough.js draws hand-sketched-looking SVG/canvas paths (rectangles, arcs, curves) with configurable "roughness," fill styles (hachure, cross-hatch, solid), and a seed for reproducibility. it slots under svgery's DOM adapter as the thing that actually draws a node's `geom` — the constraint graph decides *where* and *what* a node is (frame, role, attrs); rough.js decides *how the path looks* (the sketchy line quality). same seed-per-node convention as our style-layer sampling keeps re-renders visually stable across ops (a window that gets relit doesn't re-sketch with new jitter). this is a renderer-layer decision, doesn't change the graph schema in docs/facadia-architecture.md.

## open items for next research pass (not yet done — flagging, not guessing)

- non-western vocabulary (machiya, hanok, Amsterdam gable subtypes) sourced only from the original concept-guide chat, not yet cross-checked against a preservation-glossary-equivalent source the way NYC was. do before writing `rules/cities/tokyo.json` etc.
- Nocturne Views' existing implemented spec (horizontal infinite scroll, click-to-zoom camera pan into a window, right-click → toggle apartment lights on/off + window blinds open/closed) is the product-side contract facadia's `set_window_state` op must satisfy exactly — worth a lightweight compatibility check once f5 (nocturne integration) starts, not now.
