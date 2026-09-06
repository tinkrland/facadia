# research background: what exists before we build

the phase 0 answer to "has anyone done this". svgery's ingredients each have decades of prior art — the novelty is the combination, and the combination is load-bearing. survey below: what we take, what we reject, and the engine architecture that falls out.

## 1. geometric constraint solving (cad)

the oldest, deepest prior art. cad sketch solvers have done "geometry + constraints → valid configuration" for ~40 years.

- survey: [geometric constraint solvers (arXiv:1608.05205)](https://arxiv.org/abs/1608.05205)
- core algorithmic idea: the **DR-plan** — recursively decompose the constraint graph into small rigid clusters, solve clusters independently, merge in dependency order. see sitharam et al., [a principled approach towards symbolic geometric constraint solving](https://www.semanticscholar.org/paper/20bb20ae4720eeda718926e72a7f01e8f14756a2), and the graph-constructive two-phase tradition (analysis → construction sequence).
- production reference: the [freecad sketcher](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Workbench.md) — degrees-of-freedom reporting, redundant-constraint detection, partial dragging.

**take:** dof accounting (every node declares free parameters; every constraint consumes some; an op is admissible iff the affected cluster stays solvable) and decomposition (an edit re-solves only its cluster, not the world). this is exactly the machinery that makes edits surgical instead of global.

**reject:** general numerical solving as the first cut. our constraints are ratio locks, joint pins, whitelists — symbolic/rule checks cover them. pull in numerics only when a real op demands it.

## 2. cassowary (incremental linear constraints)

[cassowary](https://constraints.cs.washington.edu/cassowary/) — incremental dual-simplex for linear equalities/inequalities with required/preferred strengths. powers apple autolayout; there's a [cassowary.js](https://github.com/slightlyoff/cassowary.js/) port.

**take:** ratio locks and even-respacing are linear constraints — cassowary is a plausible solve step for `stretch` / `insert_tier` respacing. incremental solving = only touched constraints re-solve, which rhymes with surgery. worth a phase-1 spike, not a commitment.

## 3. shape grammars

[stiny & gips, 1972](https://dl.acm.org/doi/pdf/10.1145/1667239.1667261): generation as rule application, rules of the form A → B over shapes. there is literally a [grammar-based model for the mass customisation of chairs](https://link.springer.com/article/10.1007/s00004-015-0265-5).

**take:** edit ops *are* rules. the whitelist is the grammar; generation is a rule-application sequence.

**the one genuinely new move:** classic shape grammars operate on unlabeled shapes, which creates the famous shape-emergence problem — you can't reliably find "the left arm of the chair" in a pile of lines. svgery operates on **labeled nodes with stable ids**. labeling trades emergence for addressability, and addressability is exactly what surgical editing needs. shape-grammar semantics on an identity-preserving carrier.

## 4. parametric history-based cad

feature trees, [rollback bars](https://www.varsitytutors.com/practice/subjects/autodesk-fusion-360/lessons/editing-timeline-features), edit semantics, [repair managers](https://www.onshape.com/en/blog/tackling-history-based-errors-parametric-cad-repair-manager); recent academic: [HistCAD](https://arxiv.org/html/2602.19171v1) — geometrically constrained parametric history.

**take:** the op log is a history tree; replay = rollback; provenance doubles as the regression suite (already in phase 0).

**reject:** cad's global-rebuild-on-edit semantics. "change one parameter, recompute the whole tree" is redraw wearing a cad hat. local re-solve or the thesis has failed.

## 5. multi-view orthographic projection

drafting standards: [multiview orthographic projection](https://en.wikipedia.org/wiki/Multiview_orthographic_projection), first-angle (ISO/E) vs third-angle (ISO/A) placement, ISO 128 / ASME Y14.5 conventions. dimensions.com drawings live inside these rules.

**take:** the view set (front/side/top/iso) is standard practice — the corpus already speaks it. more importantly, drafting *mandates* view consistency: views are projections of one object. so our core invariant is not a novel claim, it's a formalized version of what every drafting standard assumes. we're not fighting the corpus; we're enforcing it.

## 6. keyed identity (the react precedent)

react's reconciliation: elements keep identity across updates iff their [key](https://legacy.reactjs.org/docs/reconciliation.html) is stable; renumber keys and you get remounts — identity death, state loss, redraw. svgery invariant #1 (ids are addresses, never renumbered) is the react key rule applied to drawings, and react's minimal-dom-patch diff is the browser-level precedent for surgical edits over rebuilds.

**take:** the keyed svg adapter is a reconciliation layer: node id → element, per view; edits produce minimal patches keyed by id.

## 7. the axonometric reality check

svg has no native 3D. but iso/3-4 views of boxy furniture are affordable: most ikea geometry is **extruded 2D profiles** — top view + front view determine the extrusion, and each view is then a 2D affine projection. for the boxy case, views are *derived* from a thin extrusion model + per-view projection matrices. no 3D engine needed.

honest limit: non-boxy geometry (chairs with splayed legs, soft furniture) breaks the thin-extrusion assumption. fallback for those: authored per-view paths + consistency checks against the graph. if we ever need real 3D, we've left svgery and entered a 3d tool's territory — out of scope by design.

## what falls out: the core engine

engine-first, demo-agnostic. the kallax shelf is the first consumer, not the codebase.

```
svgery core
├── graph/    nodes, constraints, ops as pure data (json per docs/constraint-graph.md)
├── check/    pure: (graph, op) → reject | effects. dof accounting; rule checks
│             first, cassowary spike for the linear bits (stretch, respacing)
├── apply/    deterministic: (graph, effects) → graph'. never touches svg.
├── dom/      keyed svg adapter: node id → element per view; minimal patches,
│             react-style reconciliation. the only module that sees an svg.
├── views/    extrusion model + per-view projection matrices; authored-path fallback
└── log/      op log, sha256 canonical serialization, replay (provenance = regression)
```

build order: `graph` → `check` → `apply` (pure, testable, no browser needed), then `log`, then `dom`, then `views`. the demo — context menu on a shelf — is a thin consumer wired to core.

**verdict:** no research gap blocks the engine. the gap svgery aims at is the *combination* — labeled identity + grammar-typed ops + projection-derived views on a redraw-native medium (svg). every ingredient is proven; nobody has combined them to keep a drawing's identity through generation.
