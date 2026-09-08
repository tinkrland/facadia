// facadia — style layers. the rule-side of the system (docs/facadia-architecture.md §2).
//
// graph-side facts (a window's frame, a floor's id) live in the constraint graph.
// rule-side facts (whether london permits a fire escape, how ornamented an era is)
// live here: plain data, stacked, resolved deterministically. no llm inside.

/** the five layer kinds, in resolution precedence order (later wins a range conflict). */
export const LAYER_KINDS = ['family', 'city', 'era', 'typology', 'condition', 'slider'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** precedence index: a vernacular family is the substrate, a typology's dna overrides it. */
export const PRECEDENCE: Record<LayerKind, number> = LAYER_KINDS.reduce(
  (acc, k, i) => ((acc[k] = i), acc),
  {} as Record<LayerKind, number>
);

/**
 * one statement a layer makes about one key of one subsystem.
 * silence is neutral: a layer that does not mention a key does not vote on it.
 */
export interface Entry {
  /** multiplicative preference. 0.15 uncommon · 1 allowed · 4 preferred. */
  weight?: number;
  /** absorbing: nothing can resurrect a forbidden key. "not that kind of thing." */
  forbid?: true;
  /** auto-inserted, and cannot be removed while this layer is active. */
  require?: true;
  /** numeric parameter bounds (floors, width, ornament density). intersected across layers. */
  range?: [number, number];
}

/** a lerped effect a slider applies to a target key or glob. */
export interface SliderEffect {
  /** "details.cornice", "details.*", "ornament.density" — subsystem.key, key may glob. */
  target: string;
  /** weight multiplier at slider value 0 and 1. lerped between. */
  at0?: number;
  at1?: number;
  /** range endpoints at slider value 0 and 1. lerped elementwise. */
  rangeAt0?: [number, number];
  rangeAt1?: [number, number];
}

/** a rule table as authored on disk: id + kind + subsystems keyed by name. */
export interface RuleLayer {
  id: string;
  kind: LayerKind;
  /** ids of layers stacked *beneath* this one — how a city inherits a vernacular family. */
  extends?: string[];
  /** subsystem -> key -> entry. "roof" -> "mansard" -> { weight: 3 }. */
  subsystems: Record<string, Record<string, Entry>>;
  /** slider layers only. */
  effects?: SliderEffect[];
  /** slider layers only: value used when the caller does not bind one. */
  default?: number;
}

/** the five compatibility tiers from the concept guide, derived from a resolved weight. */
export type Compat = 'required' | 'preferred' | 'allowed' | 'uncommon' | 'forbidden';

export interface ResolvedEntry {
  key: string;
  /** product of every contributing layer's weight. exactly 0 iff forbidden. */
  weight: number;
  compat: Compat;
  required: boolean;
  forbidden: boolean;
  range?: [number, number];
  /** layer ids that voted on this key — provenance for "why is this building like this". */
  sources: string[];
}

export type ConflictKind = 'require-vs-forbid' | 'empty-range' | 'unknown-extends';

export interface Conflict {
  kind: ConflictKind;
  subsystem: string;
  key: string;
  layers: string[];
  detail: string;
}

export interface Resolved {
  /** subsystem -> key -> resolved entry. */
  subsystems: Record<string, Record<string, ResolvedEntry>>;
  /** the layer ids that produced this resolution, in stack order. */
  stack: string[];
  /** real architectural contradictions (a new york cottage's fire escape), never silent. */
  conflicts: Conflict[];
}

/** weight + required flag -> the tier a human reads. */
export function compatOf(weight: number, required: boolean): Compat {
  if (weight <= 0) return 'forbidden';
  if (required) return 'required';
  if (weight < 0.5) return 'uncommon';
  if (weight >= 4) return 'preferred';
  return 'allowed';
}
