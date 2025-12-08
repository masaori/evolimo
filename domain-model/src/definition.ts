// User-defined physics laws and genetic parameter structure

import { ops, type GroupConfig, type PhysicsRule } from './builder.js';

// 1. Parameter group definitions (Phenotype Engine output structure)
export const GROUPS = {
  ATTR: { name: 'attributes', activation: 'softmax' } as const satisfies GroupConfig,
  PHYS: { name: 'physics', activation: 'tanh' } as const satisfies GroupConfig,
} as const;

// 2. State variables and parameter references
const S = {
  x: ops.state('pos_x'),
  v: ops.state('vel_x'),
  energy: ops.state('energy'),
} as const;

const P = {
  // ATTR group: metabolism, move_cost (trade-off relationship, sum=1.0)
  metabolism: ops.param('metabolism', GROUPS.ATTR.name),
  move_cost: ops.param('move_cost', GROUPS.ATTR.name),

  // PHYS group: physical characteristics (range: -1.0 to 1.0)
  drag: ops.param('drag_coeff', GROUPS.PHYS.name),
} as const;

const C = {
  dt: ops.const(0.1),
  one: ops.const(1.0),
} as const;

// 3. Physics update rules
export const rules: PhysicsRule[] = [
  // Velocity update: v = v - (v * drag * dt)
  {
    target_state: 'vel_x',
    expr: ops.sub(S.v, ops.mul(ops.mul(S.v, P.drag), C.dt)),
  },
  // Position update: x = x + v * dt
  {
    target_state: 'pos_x',
    expr: ops.add(S.x, ops.mul(S.v, C.dt)),
  },
  // Energy consumption: energy = energy - metabolism * dt
  {
    target_state: 'energy',
    expr: ops.sub(S.energy, ops.mul(P.metabolism, C.dt)),
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
