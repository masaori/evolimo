// User-defined physics laws and genetic parameter structure

import { ops } from './builder.js';
import type {
  BoundaryCondition,
  DynamicsRule,
  GroupConfig,
  InitializationIR,
  ParameterGroups,
  VisualMapping,
} from './types.js';

export const SIM_CONSTANTS = {
  n_agents: 100,
  gene_len: 32,
  hidden_len: 64,
};

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
} as const;

const GENETIC_PARAMS = {
  // Keep at least one param per group so the phenotype engine stays well-formed.
  dummy_attr: ops.param('dummy_attr', PARAMETER_GROUPS.ATTR.name),
  grav_g: ops.param('grav_g', PARAMETER_GROUPS.PHYS.name),
} as const;

const CONSTANTS = {
  one: ops.const(1.0),
  eps: ops.const(1e-4),
  zero: ops.const(0.0),
} as const;

// Canonical state ordering used for the simulator state tensor.
// Keep this stable to avoid reindexing bugs between TS IR and Rust.
export const STATE_VAR_ORDER: (keyof typeof STATE_VARS)[] = ['pos_x', 'pos_y', 'vel_x', 'vel_y', 'size'];

// 2.5. Initialization configuration (initial distributions + hyperparameters)
// Keep this as the single source of truth for simulator initial conditions.
export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: -WORLD_SIZE_X / 6, high: WORLD_SIZE_X / 6 },
    pos_y: { kind: 'uniform', low: -WORLD_SIZE_Y / 6, high: WORLD_SIZE_Y / 6 },
    vel_x: { kind: 'normal', mean: 0.0, std: 10.0 },
    vel_y: { kind: 'normal', mean: 0.0, std: 10.0 },
    size: { kind: 'uniform', low: 1.0, high: 1.1 },
  },
  // This is used to sample the gene tensor (n_agents x gene_len).
  genes: { kind: 'normal', mean: 0.0, std: 1.0 },
};

// 2.6. Boundary conditions
// Boundary conditions are intentionally disabled for now to keep the
// implementation purely tensor-based (no CPU-side rem_euclid).
export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [];

// 3. Internal dynamics update rules (time evolution)
const GRAVITY_CONST = 10.0;
export const DYNAMICS_RULES: DynamicsRule[] = [
  {
    target_state: 'pos_x',
    // Position update: x += v_x * dt
    expr: ops.add(STATE_VARS.pos_x, STATE_VARS.vel_x),
  },
  {
    target_state: 'pos_y',
    // Position update: y += v_y * dt
    expr: ops.add(STATE_VARS.pos_y, STATE_VARS.vel_y),
  },
  {
    target_state: 'vel_x',
    // Velocity update: v_x += a_x * dt (gravity only)
    expr: (() => {
      const x = STATE_VARS.pos_x;
      const y = STATE_VARS.pos_y;
      const m = STATE_VARS.size;
      const vx = STATE_VARS.vel_x;

      const xT = ops.transpose(x, 0, 1);
      const yT = ops.transpose(y, 0, 1);
      const mT = ops.transpose(m, 0, 1);

      const dx = ops.sub(xT, x);
      const dy = ops.sub(yT, y);

      // r^2 + eps to avoid singularities on the diagonal.
      const d2 = ops.add(ops.add(ops.mul(dx, dx), ops.mul(dy, dy)), CONSTANTS.eps);
      // const inv_r = ops.div(CONSTANTS.one, ops.sqrt(d2));
      // const inv_r3 = ops.div(inv_r, d2);
      const inv_r2 = ops.div(CONSTANTS.one, d2);

      // a_x = G * sum_j( m_j * dx / r^3 )  (dx points i->j)
      const ax_grav = ops.sum(ops.mul(ops.mul(mT, dx), inv_r2), 1, true);

      // Gravity strength is fully constant for now.
      // Keep 1 param per group alive (for phenotype tensor shapes) without affecting dynamics.
      const _keep_params = ops.add(
        ops.mul(GENETIC_PARAMS.grav_g, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      );
      const g = ops.add(ops.const(GRAVITY_CONST), _keep_params);

      const dv = ops.mul(g, ax_grav);
      return ops.add(vx, dv);
    })(),
  },
  {
    target_state: 'vel_y',
    expr: (() => {
      const x = STATE_VARS.pos_x;
      const y = STATE_VARS.pos_y;
      const m = STATE_VARS.size;
      const vy = STATE_VARS.vel_y;

      const xT = ops.transpose(x, 0, 1);
      const yT = ops.transpose(y, 0, 1);
      const mT = ops.transpose(m, 0, 1);

      const dx = ops.sub(xT, x);
      const dy = ops.sub(yT, y);

      // r^2 + eps to avoid singularities on the diagonal.
      const d2 = ops.add(ops.add(ops.mul(dx, dx), ops.mul(dy, dy)), CONSTANTS.eps);
      // const inv_r = ops.div(CONSTANTS.one, ops.sqrt(d2));
      // const inv_r3 = ops.div(inv_r, d2);
      const inv_r2 = ops.div(CONSTANTS.one, d2);
      const ay_grav = ops.sum(ops.mul(ops.mul(mT, dy), inv_r2), 1, true);

      // Gravity strength is fully constant for now.
      // Keep 1 param per group alive (for phenotype tensor shapes) without affecting dynamics.
      const _keep_params = ops.add(
        ops.mul(GENETIC_PARAMS.grav_g, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      );
      const g = ops.add(ops.const(GRAVITY_CONST), _keep_params);
      const dv = ops.mul(g, ay_grav);
      return ops.add(vy, dv);
    })(),
  },
];

// 4. Visual mapping configuration
export const VISUAL_MAPPING: VisualMapping = {
  position: {
    x: 'pos_x',
    y: 'pos_y',
  },
  size: {
    source: 'size',
    valueRange: [1, 10],
    range: [2, 20],
    scale: 'sqrt',
  },
};

// Extract state variable names from rules
export function extractStateVars(rules: DynamicsRule[]): string[] {
  const vars = new Set<string>();
  for (const rule of rules) {
    vars.add(rule.target_state);
  }
  return Array.from(vars).sort();
}
