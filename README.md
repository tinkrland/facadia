# facadia

a procedural architecture engine. you tell it *"a small london cottage"* and it builds you a london-looking cottage - from rules, not from a pile of pre-drawn assets.

the trick: a building is a **recipe made of architectural parts**, and the place tells the recipe which parts are appropriate. cottage is the recipe. london is the accent. run the same cottage recipe through `london`, `new england`, and `iceland` and you get three different cottages — none of them drawn by hand.

> a building = typology (what it *is*) × place (how it *expresses*).

that split is the whole idea. keep the two apart and a handful of recipes becomes thousands of buildings.

## the goal

facadia is a **procedural streetscape engine**, not a building generator. the goal is procedurally generated **front-facing facades** aka whole illustrated streets assembled from reusable vector parts (windows, doors, roofs, storefronts, cornices, fire escapes, chimneys, stoops, lamps) under architectural rules. every piece is a component the rules place, never a pixel.

it doesn't randomize pixels — it procedurally builds, not randomly *architecture*. this is not an ai image generator. the wizard never asks "what building do you want?"; it asks "what *place* is this?", and the answer sets the rules that decide how the facades get assembled. the result should feel like drawing a tiny illustrated neighborhood, not rolling dice on a building.

everything is front elevation; flat, orthographic, no perspective and in a hand-drawn storybook register: clean ink outlines, slightly imperfect lines, cozy proportions, flat muted color. so the facades line up side by side and read as one street, one place.

<img height="225" alt="image" src="https://github.com/user-attachments/assets/3806e88b-82d7-4f7a-9ff9-21735f2efb17" />
<img width="100%" height="225" alt="image" src="https://github.com/user-attachments/assets/5b298436-12eb-4b52-92b8-4590075a90c6" />



## architecture isn't random

a city's look isn't decoration; it's the residue of everything that shaped it. weather sets the roof: steep to shed snow and rain, flat where neither really comes. the material at hand sets the walls. brick where there's clay, stone where there's a quarry, timber where there's forest. historic rulers and colonial influence stamp a vocabulary onto a place that outlives the empire that brought it. flooding and terrain lift the front door up a stoop, or the whole house onto stilts. rivers, canals, and land value squeeze frontages narrow and tall. nothing here is arbitrary. it all ties back.

that's why facadia is rules, not dice. the layers aren't arbitrary knobs; they stand in for those real forces, so a place assembles itself *for reasons*. london comes out londony because the rules remember **why** it looks that way.



## the one move

most generators keep a "london cottage" asset, a "london townhouse" asset, a "london bakery" asset, then draw all of it again for dublin. facadia doesn't.

- **what a building is** lives in the typology: cottage = small, 1–2 floors, gable roof, likely a chimney, likely a garden. true in any city.
- **how it expresses in a place** lives in the city + era: london means sash windows, stock brick, brick arches, iron railings.

`london` is a thin delta over a `british` family. dublin is another delta over the same family. they share a vocabulary and still read as different cities, because each layer only carries what makes it itself.

## how it actually works

everything is **rules as data** aka plain json in `rules/`, versioned, diffable, none of it hard-coded in the engine. the layers stack:

```
family  <  city  <  era  <  typology  <  condition  <  slider
```

and resolve by three rules, nothing more:

1. **weights multiply** - `london × victorian × townhouse`.
2. **forbid is absorbing** - one layer says no, it's 0, and a slider at full tilt can't bring it back.
3. **ranges intersect** - a cottage stays cottage-sized in manhattan. if two layers genuinely disagree it says so, instead of averaging a compromise nobody authored.

and every part isn't `allowed = true`. it's one of five: **forbidden · uncommon · allowed · preferred · required**. that's what makes the output feel decided instead of random.

then sliders bend the whole thing - ornament, symmetry, verticality, storybook, so the *same* london townhouse rules render as a clean architectural illustration or a storybook version, with no second rule system.

## generation vs switching

- **generating** samples from the stacked rules. seeded: same seed + same rules = the same building, byte for byte. each subsystem draws from its own random substream, so adding a subsystem later doesn't reshuffle the ones you already have.
- **switching** a layer — say `london → new york` — never re-rolls. it diffs the two resolutions and emits only `keep · swap · drop · add · clamp`. the building keeps its id, its floors, its seed, and anything you hand-edited. windows restyle in place; the street doesn't rebuild.

that last part is inherited from where this started (svgery's pilot w a shelf you could edit without redrawing): **keep the drawing, change it under rules.** ids are addresses, like `london_rd.14.floor.2.window.3` is that window forever, sash today, arched after you switch cities, still that window. a redraw is the failure mode, not the feature.

## what it draws

not a static picture, but an **infinite side-scrolling, interactive cityscape.** [facadia.base44.app](https://facadia.base44.app) (nocturne views) is the live front: scroll right and the street keeps procedurally generating, forever. click a window and the camera pans over and zooms *into* that apartment — you peek into the room, not a popup. right-click any window for a context menu: flip the apartment lights on or off, open or close the blinds. it opens on night and toggles through dawn → day → sunset; every lit window is its own little inhabited room. a `/editor` route lets you change a building's and a window's attributes and even stage a single window aka drop in plants, set the scene inside.

the look underneath: **front-facing night elevation** is flat, orthographic, hand-inked, no perspective, no 3d. that flatness is exactly what lets the facades tile side by side into one endless street.

## where it breaks (honest)

- **cross-subsystem compatibility isn't modelled yet.** the resolver still checks parts one subsystem at a time, so it can technically pair a flat roof with shingles that need a pitch. roof-form × material and typology × entrance are the next layer.
- **some typologies are named but not drawn** — `semi_detached`, `pub`, `mews`, `council_house`, `victorian_apartment` have no dna file yet.
- **the non-western vocabulary** (machiya, hanok, amsterdam gable subtypes) came from a concept guide, not yet checked against a real preservation glossary the way nyc was.
- **the live app isn't wired to the engine yet.** the nocturne cityscape is hand-built; making the rules drive it is the point we're walking toward.

## status

real today, zero runtime deps, pure, no llm in the loop: 7 families, 11 cities, 3 eras, 16 typologies, 8 conditions, 8 sliders, 41 tests.

```
npm install && npm test          # the invariants, as a regression suite
npm run street                   # london, victorian
npm run street -- --city new_york --era italianate
npm run street -- --city london --switch new_york   # print the diff a set_city emits
npm run street -- --city london --ornament 1 --storybook 1
```

## where things live

```
docs/   the architecture, the constraint-graph schema, the research survey
rules/  the portable backend: families, cities, eras, typologies, conditions, sliders
src/    graph · check · apply · dom · views · log · rules (loader · resolver · sampler · diff)
test/   invariants
```

full architecture: [docs/facadia-architecture.md](docs/facadia-architecture.md) · rule format: [rules/schema.md](rules/schema.md).
