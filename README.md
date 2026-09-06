# svgery

svg + surgery. procedural generative manipulation of svgs by rewriting the drawing in place under a fixed constraint graph: what may move, what must stay, what ratios lock. not paper.js-style remaking the whole picture every frame.

or simply put, we think stuffing a canvas with a fresh pile of paths every frame doesn't make the drawing smarter. **keep the svg, change it under rules.** the constraint graph is the product; the renderer is just the mouth.

## why in-place mutation

most generative svg stacks treat the canvas as something you clear and rebuild. that throws away identity. a chair that was a chair is now a new pile of paths that happen to look like a chair.

svgery wants the opposite: the node is still the node. you twist it, stretch it, swap a view, and the constraints are what stop it from becoming mush. *fixed constraint setting* is the whole thesis. a lock on proportions, joints, and allowed edits so generation is surgery, not redraw.

what identity means here, concretely:

- a node keeps its id across every edit. the shelf's second tier is *that* tier before and after you recolor the whole thing.
- every mutation is a typed operation on the graph, checked against constraints, logged, reversible.
- "redraw" is the failure mode we're engineering away. if an edit can only be expressed as a fresh pile of paths, the system failed.

## the goal

a constraint graph you can trust enough to generate from. not a prettier path boolean.

the falsifier: the graph has to survive the turn from one view to the next. if switching front → isometric forces a rebuild, the thesis is dead. same object, same graph, different face.

## the shape of the system

- **document.** the svg is the source of truth. nodes carry stable ids, roles (panel, tier, joint, handle), and a local frame — position/rotation/scale relative to their parent, never baked into absolute coordinates.
- **constraint graph.** sits beside the document. three kinds of locks: ratio locks (proportions that must hold), joint pins (what connects to what, and how), edit whitelists (a shelf may gain tiers; a lamp may not grow a drawer).
- **edit ops.** small, typed operations — `insert_tier`, `stretch`, `recolor`, `rotate`, `swap_view`. each op: check the graph, apply surgically, log itself. ops compose; that's how generation happens without redraw.
- **views.** projections of the same graph, not separate drawings.

## starting point: ikea furniture

we start with ikea furniture:

- [dimensions.com](https://www.dimensions.com) technical drawing documents as our reference point for different views
- [showitbetter.co](https://showitbetter.co) kits

first target: a kallax-style shelving unit, hand-authored. right clicking it opens a context menu to make its number of tiers go up or adjust, rotate it, change color, etc. — every menu item is an edit op that has to keep the graph valid.

<img width="50%" height="430" alt="AG-FURNITURE" src="https://github.com/user-attachments/assets/42e36047-11b9-4c82-939c-46d8942d2666" />

## views

the first views are front, side, top, isometric, or 3/4 front. not a free camera. same object, same constraint graph, different face showing. the graph has to survive the turn from one view to the next, which is the whole point of not redrawing.

[dimensions.com](https://www.dimensions.com) technical drawings already live in these cameras, so that's where we start.

## plan

**phase 0 — schema, on paper first.**
define the constraint graph format: node ids, roles, local frames, ratio locks, joint pins, edit whitelists, view projections. first draft exists: [docs/constraint-graph.md](docs/constraint-graph.md). research survey: [docs/research-background.md](docs/research-background.md). the format is the product; get it wrong and everything downstream is redraw with extra steps.

**phase 1 — core engine, demo-agnostic.**
svgery core as a pure library, built before any demo: graph store (nodes/constraints/ops as data), pure checker (`(graph, op) → reject | effects`, dof accounting borrowed from cad), deterministic applier, keyed svg adapter (node id → element, minimal patches, react-style reconciliation), view projections (thin extrusion model + per-view affine matrices), op log with replay. the shelf is a consumer, not the codebase. prior art + engine notes: [docs/research-background.md](docs/research-background.md).

status: **core + views + dom adapter exist** — `src/` + `test/` (30 tests, `npm install && npm test`), zero runtime deps.

- **views/** — one camera for all views: front/side/top are orthographic presets (az/el), iso is axonometric. boxy furniture = extruded 2D profiles (frame is the front face, the `depth` attr extrudes it, children inherit depth). every view is *derived* — a projection of the same graph, never an independent drawing.
- **dom/** — the keyed svg adapter: node id → element, minimal patches, react-style reconciliation. recolor patches one element; insert patches one add plus the respaced tiers; **swap_view patches zero adds and zero removes** — the falsifier, made mechanical and tested.
- **demo/** — the kallax shelf as a thin consumer. right-click the shelf: insert/remove tiers, stretch, recolor, rotate, turn views. every visible change is an op: checked, applied, logged (provenance panel shows checksums), patched. `npm run build && npx serve .` → open `demo/`.

**phase 2 — one shelf, hand-authored.**
hand-build the shelving unit: svg per view (front, side, top, iso) + its constraint graph + the edit ops (`insert_tier`, `remove_tier`, `stretch`, `recolor`, `rotate`, `swap_view`). no generation yet. prove that surgical edits keep identity and that views stay consistent after every op. ship the right-click context menu demo.

**phase 3 — persistence + provenance (xano).**
graph state and the edit log go to xano (details below). the edit log is the provenance layer: every op logged with params and pre/post checksums, replayable — so the log doubles as a regression suite for the mutation engine. mutate locally, push the diff, replay on load.

**phase 4 — extraction.**
reference corpus → candidate graphs. firecrawl pulls the technical drawings into a local cache; minimax drafts constraint graphs from drawings + measurements; a human signs each graph before it's canonical. extraction is assistive, never authoritative.

**phase 5 — the benchmark.**
when does in-place beat redraw? define metrics before building anything fancy: node survival rate across edits, graph validity after view turns, constraint violations per op, redraw-count per session (target: zero). otherwise we're grading our own homework.

## tooling plan

**xano — state + provenance.** new branch on our existing instance (substrate stays untouched). tables:

- `svgery_doc` — one object: its svg per view
- `svgery_node` — graph nodes (id, role, local frame, doc ref)
- `svgery_constraint` — the locks: ratio, joint, whitelist, with scope (global / per-node / per-edit)
- `svgery_edit` — the op log: op, params, pre/post checksum, actor. replay = regression suite.

**firecrawl — reference corpus.** pull multi-view furniture drawings once into a local cache; never scrape in a loop.

**minimax / bge — drafting + matching.** minimax drafts graphs from drawings (cheap drafting model we already trust); bge-small (pinned, local — the same model substrate calibrated) for drawing-to-drawing similarity when matching "same object, different view". bank the other llm credits unless a step truly needs them.

**stays local + deterministic:** the renderer (svg in the browser) and the constraint checker (pure code). one rule worth keeping: the llm drafts graphs and suggests edits, but *never executes them*. execution is deterministic code over the graph. that's what makes it surgery and not vibes.
