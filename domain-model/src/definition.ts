// User-defined physics laws and genetic parameter structure

import { ops } from './builder.js';
import type {
  AllPairsExclusion2D,
  BoundaryCondition,
  GroupConfig,
  InitializationIR,
  PhysicsRule,
  ParameterGroups,
  VisualMapping,
} from './types.js';

const WORLD_SIZE_X = 1024.0;
const WORLD_SIZE_Y = 800.0;

// 1. Parameter group definitions (Phenotype Engine output structure)
export const PARAMETER_GROUPS: ParameterGroups = {
  ATTR: { name: 'attributes', activation: 'softmax' } satisfies GroupConfig,
  PHYS: { name: 'physics', activation: 'tanh' } satisfies GroupConfig,
};

// 2. State variables and parameter references
const STATE_VARS = {
  pos_x: ops.state('pos_x'),
  pos_y: ops.state('pos_y'),
  vel_x: ops.state('vel_x'),
  vel_y: ops.state('vel_y'),
  size: ops.state('size'),
  energy: ops.state('energy'),
} as const;

const GENETIC_PARAMS = {
  // ATTR group: metabolism, move_cost (trade-off relationship, sum=1.0)
  metabolism: ops.param('metabolism', PARAMETER_GROUPS.ATTR.name),
  move_cost: ops.param('move_cost', PARAMETER_GROUPS.ATTR.name),

  // PHYS group: physical characteristics (range: -1.0 to 1.0)
  drag: ops.param('drag_coeff', PARAMETER_GROUPS.PHYS.name),
} as const;

const CONSTANTS = {
  dt: ops.const(0.1),
  one: ops.const(1.0),
} as const;

// Canonical state ordering used for the simulator state tensor.
// Keep this stable to avoid reindexing bugs between TS IR and Rust.
export const STATE_VAR_ORDER = ['pos_x', 'pos_y', 'vel_x', 'vel_y', 'size', 'energy'] as const;

// 2.5. Initialization configuration (initial distributions + hyperparameters)
// Keep this as the single source of truth for simulator initial conditions.
export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: -WORLD_SIZE_X / 2, high: WORLD_SIZE_X / 2 },
    pos_y: { kind: 'uniform', low: -WORLD_SIZE_Y / 2, high: WORLD_SIZE_Y / 2 },
    vel_x: { kind: 'const', value: 0.0 },
    vel_y: { kind: 'const', value: 0.0 },
    size: { kind: 'const', value: 1.0 },
    energy: { kind: 'const', value: 0.0 },
  },
  // This is used to sample the gene tensor (n_agents x gene_len).
  genes: { kind: 'normal', mean: 0.0, std: 1.0 },
};

// 2.6. Boundary conditions
// For a torus world, positions are wrapped into [min, max].
export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [
  { target_state: 'pos_x', kind: 'torus', range: [-WORLD_SIZE_X / 2, WORLD_SIZE_X / 2] },
  { target_state: 'pos_y', kind: 'torus', range: [-WORLD_SIZE_Y / 2, WORLD_SIZE_Y / 2] },
];

// 3. Neighbor interactions (computed outside the per-agent expression tree)
// Stage-A implementation is O(N^2) all-pairs; suitable for validating the model.
export const INTERACTIONS: AllPairsExclusion2D[] = [
  {
    kind: 'all_pairs_exclusion_2d',
    pos: { x: 'pos_x', y: 'pos_y' },
    radius: 'size',
    cutoff: 50,
    strength: 5.0,
    eps: 1e-4,
    outputs: { fx: 'f_excl_x', fy: 'f_excl_y' },
  },
];

// 3. Physics update rules
export const PHYSICS_RULES: PhysicsRule[] = [
  // Velocity update (X-axis): vel_x = vel_x - (vel_x * drag * dt)
  {
    target_state: 'vel_x',
    // Add neighbor exclusion force (computed by INTERACTIONS) before drag.
    expr: ops.sub(
      ops.add(STATE_VARS.vel_x, ops.mul(ops.aux('f_excl_x'), CONSTANTS.dt)),
      ops.mul(ops.mul(STATE_VARS.vel_x, GENETIC_PARAMS.drag), CONSTANTS.dt)
    ),
  },
  // Velocity update (Y-axis): vel_y = vel_y - (vel_y * drag * dt)
  {
    target_state: 'vel_y',
    expr: ops.sub(
      ops.add(STATE_VARS.vel_y, ops.mul(ops.aux('f_excl_y'), CONSTANTS.dt)),
      ops.mul(ops.mul(STATE_VARS.vel_y, GENETIC_PARAMS.drag), CONSTANTS.dt)
    ),
  },
  // Position update (X-axis): pos_x = pos_x + vel_x * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, ops.mul(STATE_VARS.vel_x, CONSTANTS.dt)),
  },
  // Position update (Y-axis): pos_y = pos_y + vel_y * dt
  {
    target_state: 'pos_y',
    expr: ops.add(STATE_VARS.pos_y, ops.mul(STATE_VARS.vel_y, CONSTANTS.dt)),
  },
  // Energy consumption: energy = energy - metabolism * dt
  {
    target_state: 'energy',
    expr: ops.sub(STATE_VARS.energy, ops.mul(GENETIC_PARAMS.metabolism, CONSTANTS.dt)),
  },
];

// 4. Visual mapping configuration
export const VISUAL_MAPPING: VisualMapping = {
  position: {
    x: 'pos_x',
    y: 'pos_y',
  },
  size: {
    // Multi-source example: size affected by both 'size' state and 'energy'
    source: {
      sources: ['size', 'energy'],
      blend: 'average',
    },
    // Normalize blended size source using this input range.
    valueRange: [0, 100],
    range: [2, 20],
    scale: 'sqrt',
  },
  color: {
    // Multi-source example: color based on energy and velocity magnitude
    source: {
      sources: ['energy', 'vel_x', 'vel_y'],
      blend: 'average',
    },
    colormap: 'viridis',
    range: [0, 100],
  },
  opacity: {
    // Single source example
    source: 'energy',
    // Normalize energy using this input range, then map into [0.3, 1.0].
    valueRange: [0, 100],
    range: [0.3, 1.0],
  },
};

// Extract state variable names from rules
export function extractStateVars(rules: PhysicsRule[]): string[] {
  const vars = new Set<string>();
  for (const rule of rules) {
    vars.add(rule.target_state);
  }
  return Array.from(vars).sort();
}
