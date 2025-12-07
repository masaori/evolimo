/**
 * User-defined physics rules and genetic parameter definitions
 */

import { ops, GroupConfig, PhysicsRule } from './builder';

// 1. Define parameter groups (determines phenotype engine output structure)
export const GROUPS: Record<string, GroupConfig> = {
  ATTR: { name: 'attributes', activation: 'softmax' }, // Sum to 1.0 (resource allocation)
  PHYS: { name: 'physics', activation: 'tanh' },       // Range -1.0 to 1.0 (physics coefficients)
};

// 2. Define state variables and parameters
const S = {
  x: ops.state('pos_x'),
  v: ops.state('vel_x'),
  energy: ops.state('energy'),
};

const P = {
  // ATTR group: Metabolism and movement cost (tradeoff relationship)
  metabolism: ops.param('metabolism', GROUPS.ATTR.name),
  move_cost: ops.param('move_cost', GROUPS.ATTR.name),
  
  // PHYS group: Physical characteristics
  drag: ops.param('drag_coeff', GROUPS.PHYS.name),
};

const C = {
  dt: ops.const(0.1), // Time step
};

// 3. Define physics update rules
export const rules: PhysicsRule[] = [
  // Velocity update: v = v - (v * drag * dt)
  {
    target_state: 'vel_x',
    expr: ops.sub(S.v, ops.mul(ops.mul(S.v, P.drag), C.dt))
  },
  
  // Position update: x = x + v * dt
  {
    target_state: 'pos_x',
    expr: ops.add(S.x, ops.mul(S.v, C.dt))
  },
  
  // Energy consumption: energy = energy - metabolism * dt
  // Also affected by movement cost when velocity is non-zero
  {
    target_state: 'energy',
    expr: ops.sub(
      S.energy, 
      ops.add(
        ops.mul(P.metabolism, C.dt),
        ops.mul(ops.mul(S.v, S.v), ops.mul(P.move_cost, C.dt))
      )
    )
  }
];

// Export state variable names for validation
export const STATE_VARS = ['pos_x', 'vel_x', 'energy'];
