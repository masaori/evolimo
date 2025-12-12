// User-defined physics laws and genetic parameter structure

import { ops } from './builder.js';
import type { GroupConfig, PhysicsRule, ParameterGroups, VisualMapping } from './types.js';

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

// 3. Physics update rules
export const PHYSICS_RULES: PhysicsRule[] = [
  // Velocity update: v = v - (v * drag * dt)
  {
    target_state: 'vel_x',
    expr: ops.sub(STATE_VARS.vel_x, ops.mul(ops.mul(STATE_VARS.vel_x, GENETIC_PARAMS.drag), CONSTANTS.dt)),
  },
  // Position update: x = x + v * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, ops.mul(STATE_VARS.vel_x, CONSTANTS.dt)),
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
      weights: [0.7, 0.3],  // 70% size, 30% energy
      blend: 'multiply',
    },
    range: [2, 20],
    scale: 'sqrt',
  },
  color: {
    // Multi-source example: color based on energy and velocity magnitude
    source: {
      sources: ['energy', 'vel_x', 'vel_y'],
      weights: [0.7, 0.15, 0.15],
      blend: 'add',
    },
    colormap: 'viridis',
    range: [0, 100],
  },
  opacity: {
    // Single source example
    source: 'energy',
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
