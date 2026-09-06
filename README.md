# svgery

svgery tackles procedural generative manipulation of svgs by rewriting the drawing in place under a fixed constraint graph: what may move, what must stay, what ratios lock. not paper.js-style remaking the whole picture every time.

or simply put, we think stuffing a canvas with a fresh pile of paths every frame doesn't make the drawing smarter. **keep the svg, change it under rules.** the constraint graph is the product; the renderer is just the mouth.

## the idea behind in-place mutation

most generative svg stacks treat the canvas as something you clear and rebuild. that throws away identity. a chair that was a chair is now a new pile of paths that happen to look like a chair.

svgery wants the opposite: the node is still the node. you twist it, stretch it, swap a view, and the constraints are what stop it from becoming mush. *fixed constraint setting* is the whole thesis. a lock on proportions, joints, and allowed edits so generation is surgery, not redraw.

## what's the goal

a constraint graph you can trust enough to generate from. not a prettier path boolean.

we'll start with working on this in a separate project with ikea furniture.

- [dimensions.com](https://www.dimensions.com) technical drawing documents as our reference point for different views
- [showitbetter.co](https://showitbetter.co) kits

<br>
<img width="50%" height="430" alt="AG-FURNITURE" src="https://github.com/user-attachments/assets/42e36047-11b9-4c82-939c-46d8942d2666" />

and define them in a way that right clicking this opens a context menu to make its number of tiers go up or adjusted, rotate it, change color, etc.

## views

the first views we present are front, side, top, isometric, or 3/4 front. not a free camera. same object, same constraint graph, different face showing. the graph has to survive the turn from one view to the next, which is the whole point of not redrawing.

[dimensions.com](https://www.dimensions.com) technical drawings already live in these cameras, so that's where we start.
