# the constraint graph (phase 0 schema)

one page, on paper first. this defines what the system stores, checks, and edits. the format is the product; get it wrong and everything downstream is redraw with extra steps.

## node

the atom of identity. a node is still the node no matter what you do to it.

```yaml
id: shelf.tier.2          # stable, human-readable, NEVER reused or renumbered
role: tier                 # panel | tier | joint | handle | carcass | custom
parent: shelf.carcass      # tree of frames; root = the object itself
frame:                     # local frame, relative to parent. never absolute coords.
  x: 0
  y: 386
  w: 386
  h: 386
geom: "#p-tier-2"          # reference into the svg document (per view)
attrs: { fill: "#f5f0e6" }
```

rules:

- ids are addresses, not indices. `insert_tier` does NOT renumber `shelf.tier.2` → `shelf.tier.3`. new nodes get fresh ids (`shelf.tier.2a` or counter-based suffixes); deletion is a tombstone; a dead id is never recycled.
- geometry lives in the local frame. stretching the carcass must move tiers by *recalculating frames*, not by rewriting every path's absolute coordinates.
- `geom` is per-view (the same node points at a path in the front view and a different path in the iso view). the node is the shared identity across views; the paths are just its shadows.

## constraints

three kinds of locks, plus symmetry. all live in `svgery_constraint`.

**ratio locks** — proportions that must hold.

```yaml
type: ratio
expr: "shelf.tier.*.h / shelf.carcass.h"
range: [0.20, 0.25]        # or a pinned value with tolerance
scope: global
```

**joint pins** — what connects to what, and how.

```yaml
type: joint
nodes: [shelf.carcass, shelf.tier.2]
joint: dado                  # butt | miter | dado | dowel | ...
anchor: { from: "bottom", to: "inner-top" }
dof: { x: "fixed", y: "insert", z: "fixed" }   # which way it may move
```

**edit whitelists** — what may happen at all.

```yaml
type: whitelist
node: shelf.carcass
ops:
  - insert_tier: { min: 1, max: 8, at: [top, bottom], respacing: even }
  - stretch:     { axes: [w, h], consults: ratio }
  - recolor:     { any }
```

if an op isn't whitelisted for a node, it's not that the graph can't do it — it's that the object isn't that kind of thing. a lamp may not grow a drawer.

**symmetry** — mirror constraints (the left side of a carcass implies the right). declared once, checked always.

## views

a view is a projection of the graph, never an independent drawing.

```yaml
view: front
projection: orthographic     # front | side | top = orthographic; iso | 3/4 = axonometric
camera: { az: 0, el: 0 }    # for axonometric
visible: [carcass, tier.*, back-panel]   # what the camera sees; occlusion is derived
```

the invariant that makes this svgery: switching views never touches node identity. if the front view and the iso view disagree about which tier is which, the system has already failed. views are derived from the graph; if a view has to be hand-authored separately, that's a redraw wearing a hat.

## edit ops

small, typed, composable. every op: check → apply → log.

```json
{
  "op": "insert_tier",
  "target": "shelf.carcass",
  "params": { "count": 1, "at": "top" },
  "preconditions": ["whitelisted", "tier_count < 8"],
  "effects": [
    "clone nearest tier frame as new node (fresh id)",
    "recalculate frames under ratio + respacing rule",
    "re-pin joints for all affected tiers",
    "emit view diffs for every view"
  ]
}
```

## provenance

every applied op logs to `svgery_edit`: op, params, actor, pre/post checksum (sha256 of canonical graph serialization), timestamp. replay of the log from any checkpoint must reproduce the graph exactly — which makes the edit log both provenance and the regression suite.

## invariants (the whole thesis, stated as tests)

1. node ids survive every op. clone gets a fresh id, delete leaves a tombstone, nothing is ever renumbered.
2. every state change is an op. no direct writes to the graph. no "just fix this path."
3. views are derived from one graph. front and iso must agree on identity.
4. the checker is pure: (graph, op) → reject | new graph. deterministic, no llm inside.
5. the llm may draft graphs and suggest ops, but never applies them. execution is deterministic code over the graph. surgery, not vibes.
