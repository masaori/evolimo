// User-defined physics laws and genetic parameter structure

import { ops } from './builder.js';
import type { GroupConfig, PhysicsRule, ParameterGroups } from './types.js';

// 1. Parameter group definitions (Phenotype Engine output structure)
export const PARAMETER_GROUPS: ParameterGroups = {
  ATTR: { name: 'attributes', activation: 'softmax' } satisfies GroupConfig,
  PHYS: { name: 'physics', activation: 'tanh' } satisfies GroupConfig,
};

// 2. State variables and parameter references
const STATE_VARS = {
  x: ops.state('pos_x'),
  v: ops.state('vel_x'),
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
    expr: ops.sub(STATE_VARS.v, ops.mul(ops.mul(STATE_VARS.v, GENETIC_PARAMS.drag), CONSTANTS.dt)),
  },
  // Position update: x = x + v * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.x, ops.mul(STATE_VARS.v, CONSTANTS.dt)),
  },
  // Energy consumption: energy = energy - metabolism * dt
  {
    target_state: 'energy',
    expr: ops.sub(STATE_VARS.energy, ops.mul(GENETIC_PARAMS.metabolism, CONSTANTS.dt)),
  },
];

// Extract state variable names from rules
export function extractStateVars(rules: PhysicsRule[]): string[] {
  const vars = new Set<string>();
  for (const rule of rules) {
    vars.add(rule.target_state);
  }
  return Array.from(vars).sort();
}
