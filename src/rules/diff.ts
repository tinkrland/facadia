// facadia — the diff-walk. docs/facadia-architecture.md §3, made mechanical.
//
// THE INVARIANT: switching one style layer is one op with bounded, diff-derived
// effects. set_city on a london townhouse restyles what london forbids and nothing
// else. it does not resample the building, it does not renumber anything, and it
// does not touch a choice the new city is perfectly happy with.
//
// so this module is deliberately incapable of regenerating: it only ever
//   keep   — the current value survives the new vocabulary
//   swap   — the current value became forbidden, so re-choose deterministically
//   drop   — a present feature is now forbidden
//   add    — a feature is now required
//   clamp  — a number fell outside the new range, so move it the minimum distance
//
// there is no sixth verb, and none of them consult a fresh random stream.

import type { Resolved } from './types';
import { candidates, requiredKeys } from './resolve';
import type { BuildingRecipe } from './sample';
import { pickWeighted, selectedTypology, substream } from './sample';

export type ChangeKind = 'keep' | 'swap' | 'drop' | 'add' | 'clamp';

export interface Change {
  kind: ChangeKind;
  path: string;
  from: string | number | null;
  to: string | number | null;
  why: string;
}

export interface SwitchResult {
  recipe: BuildingRecipe;
  changes: Change[];
}

/** changes that actually altered something — 'keep' entries are provenance, not edits. */
export function edits(changes: Change[]): Change[] {
  return changes.filter((c) => c.kind !== 'keep');
}

function alive(r: Resolved, subsystem: string, key: string | null): boolean {
  if (key === null) return false;
  const e = r.subsystems[subsystem]?.[key];
  return !!e && e.weight > 0;
}

/**
 * a single-valued choice. survives untouched if the new vocabulary still permits it —
 * this is the clause that stops set_city from being a redraw.
 */
function reconcileOne(
  r: Resolved,
  subsystem: string,
  path: string,
  current: string | null,
  seed: string,
  changes: Change[]
): string | null {
  if (alive(r, subsystem, current)) {
    changes.push({ kind: 'keep', path, from: current, to: current, why: `${subsystem}.${current} still permitted` });
    return current;
  }
  const replacement = pickWeighted(substream(seed, 'switch', subsystem), candidates(r, subsystem))?.key ?? null;
  changes.push({
    kind: 'swap',
    path,
    from: current,
    to: replacement,
    why: current === null ? `${subsystem} had no value` : `${subsystem}.${current} is forbidden by the new stack`,
  });
  return replacement;
}

/** a set of optional features: drop what is now forbidden, add what is now required, keep the rest. */
function reconcileMany(
  r: Resolved,
  subsystem: string,
  path: string,
  current: string[],
  changes: Change[]
): string[] {
  const kept = current.filter((key) => {
    if (alive(r, subsystem, key)) return true;
    changes.push({ kind: 'drop', path: `${path}.${key}`, from: key, to: null, why: `${subsystem}.${key} is forbidden by the new stack` });
    return false;
  });

  for (const req of requiredKeys(r, subsystem)) {
    if (req.weight <= 0 || kept.includes(req.key)) continue;
    kept.push(req.key);
    changes.push({ kind: 'add', path: `${path}.${req.key}`, from: null, to: req.key, why: `${subsystem}.${req.key} is required by the new stack` });
  }
  return kept.sort();
}

/** a number: clamp the minimum distance into the new range rather than redrawing it. */
function reconcileNumber(
  r: Resolved,
  subsystem: string,
  key: string,
  path: string,
  current: number,
  changes: Change[],
  integer = false
): number {
  const range = r.subsystems[subsystem]?.[key]?.range;
  if (!range) {
    changes.push({ kind: 'keep', path, from: current, to: current, why: `${subsystem}.${key} is unconstrained` });
    return current;
  }
  let next = Math.min(range[1], Math.max(range[0], current));
  if (integer) next = Math.round(next);
  if (next === current) {
    changes.push({ kind: 'keep', path, from: current, to: current, why: `${current} is inside [${range[0]}, ${range[1]}]` });
    return current;
  }
  changes.push({
    kind: 'clamp',
    path,
    from: current,
    to: next,
    why: `${current} is outside [${range[0]}, ${range[1]}] — clamped, not resampled`,
  });
  return next;
}

/**
 * apply a new resolved stack to an existing recipe.
 *
 * pure: (recipe, newResolved) -> (recipe, changes). the seed is carried, never
 * re-rolled, so a switch is replayable and an A -> B -> A round trip is stable
 * for everything the two stacks agree on.
 */
export function switchStack(recipe: BuildingRecipe, next: Resolved): SwitchResult {
  const changes: Change[] = [];
  const seed = recipe.seed;

  // a typology on the new stack is a selection, not a preference — set_city must not
  // move a townhouse to a semi-detached just because the new city likes those more.
  const selected = selectedTypology(next);
  let typology: string | null;
  if (selected !== null) {
    typology = selected;
    changes.push(
      selected === recipe.typology
        ? { kind: 'keep', path: 'typology', from: recipe.typology, to: selected, why: 'typology is selected by the stack' }
        : { kind: 'swap', path: 'typology', from: recipe.typology, to: selected, why: `the new stack selects typology:${selected}` }
    );
  } else {
    typology = reconcileOne(next, 'typologies', 'typology', recipe.typology, seed, changes);
  }
  const roofForm = reconcileOne(next, 'roof', 'roof.form', recipe.roof.form, seed, changes);
  const roofMaterial = reconcileOne(next, 'roof_material', 'roof.material', recipe.roof.material, seed, changes);
  const material = reconcileOne(next, 'facade', 'facade.material', recipe.facade.material, seed, changes);
  const windowStyle = reconcileOne(next, 'windows', 'windows.style', recipe.windows.style, seed, changes);
  const entrance = reconcileOne(next, 'entrance', 'entrance.type', recipe.entrance.type, seed, changes);

  return {
    recipe: {
      ...recipe,
      stack: [...next.stack],
      typology,
      massing: {
        floors: reconcileNumber(next, 'massing', 'floors', 'massing.floors', recipe.massing.floors, changes, true),
        width: reconcileNumber(next, 'massing', 'width', 'massing.width', recipe.massing.width, changes),
        verticality: reconcileNumber(next, 'massing', 'verticality', 'massing.verticality', recipe.massing.verticality, changes),
      },
      roof: {
        form: roofForm,
        material: roofMaterial,
        accessories: reconcileMany(next, 'roof_accessories', 'roof.accessories', recipe.roof.accessories, changes),
      },
      facade: {
        material,
        ornamentDensity: reconcileNumber(next, 'ornament', 'density', 'facade.ornamentDensity', recipe.facade.ornamentDensity, changes),
      },
      windows: { style: windowStyle },
      entrance: { type: entrance },
      ground: {
        setback: reconcileNumber(next, 'ground', 'setback', 'ground.setback', recipe.ground.setback, changes),
        features: reconcileMany(next, 'ground', 'ground.features', recipe.ground.features, changes),
      },
      details: reconcileMany(next, 'details', 'details', recipe.details, changes),
      attachments: reconcileMany(next, 'attachments', 'attachments', recipe.attachments, changes),
      vegetation: reconcileMany(next, 'vegetation', 'vegetation', recipe.vegetation, changes),
      conflicts: next.conflicts.map((c) => c.detail),
    },
    changes,
  };
}
