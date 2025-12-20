// Example: Fixed-Capacity Grid based Gravity Simulation

import { ops } from '../builder.js';
import type {
  BoundaryCondition,
  DynamicsRule,
  GroupConfig,
  InitializationIR,
  ParameterGroups,
  VisualMapping,
  GridConfig,
} from '../types.js';

export const SIM_CONSTANTS = {
  n_agents: 10,
  gene_len: 32,
  hidden_len: 64,
};

const WORLD_SIZE_X = 10240.0;
const WORLD_SIZE_Y = 8000.0;

// Grid Configuration
// 10240 / 128 = 80
// 8000 / 125 = 64
export const GRID_CONFIG: GridConfig = {
  width: 80,
  height: 64,
  capacity: 8,
  cell_size: [128.0, 125.0],
};

// 1. Parameter group definitions
export const PARAMETER_GROUPS: ParameterGroups = {
  ATTR: { name: 'attributes', activation: 'softmax' } satisfies GroupConfig,
  PHYS: { name: 'physics', activation: 'tanh' } satisfies GroupConfig,
};

// 2. State variables
const STATE_VARS = {
  pos_x: ops.state('pos_x'),
  pos_y: ops.state('pos_y'),
  vel_x: ops.state('vel_x'),
  vel_y: ops.state('vel_y'),
  size: ops.state('size'),
} as const;

const GENETIC_PARAMS = {
  dummy_attr: ops.param('dummy_attr', PARAMETER_GROUPS.ATTR.name),
  grav_g: ops.param('grav_g', PARAMETER_GROUPS.PHYS.name),
} as const;

const CONSTANTS = {
  one: ops.const(1.0),
  zero: ops.const(0.0),
  dt: ops.const(0.1), // Time step
} as const;

export const STATE_VAR_ORDER: (keyof typeof STATE_VARS)[] = ['pos_x', 'pos_y', 'vel_x', 'vel_y', 'size'];

// 3. Dynamics Rules
export const DYNAMICS_RULES: DynamicsRule[] = [
  // Update Position: pos += vel * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, ops.mul(STATE_VARS.vel_x, CONSTANTS.dt)),
  },
  {
    target_state: 'pos_y',
    expr: ops.add(STATE_VARS.pos_y, ops.mul(STATE_VARS.vel_y, CONSTANTS.dt)),
  },

  // Update Velocity: vel += force * dt
  // Force is computed via Grid Stencil
  {
    target_state: 'vel_x',
    expr: (() => {
      // 1. Prepare state tensor for grid: [pos_x, pos_y, vel_x, vel_y, size]
      // We need to concatenate them along dim 1 (columns)
      // Note: ops.cat expects [N, 1] inputs and produces [N, 5]
      const state_vec = ops.cat([
        STATE_VARS.pos_x,
        STATE_VARS.pos_y,
        STATE_VARS.vel_x,
        STATE_VARS.vel_y,
        STATE_VARS.size
      ], 1);

      // 2. Scatter to Grid
      // grid_state: [H, W, Cap, 5]
      const grid_state = ops.grid_scatter(state_vec, STATE_VARS.pos_x, STATE_VARS.pos_y);

      // 3. Compute Stencil Interactions (Gravity)
      // Returns updated grid state with forces in vel slots (indices 2 and 3)
      // result_grid: [H, W, Cap, 5] (but only indices 2,3 have forces, others 0)
      const force_grid = ops.stencil(grid_state, 1); // 3x3 neighborhood

      // 4. Gather back to particles
      // force_vec: [N, 5]
      const force_vec = ops.grid_gather(force_grid, STATE_VARS.pos_x, STATE_VARS.pos_y);

      // 5. Extract Force X (index 2)
      const fx = ops.slice(force_vec, 1, 2, 1);

      // Keep params alive to ensure PhenotypeEngine produces valid tensors
      const _keep_params = ops.add(
        ops.mul(GENETIC_PARAMS.grav_g, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      );

      // Update vel_x
      return ops.add(STATE_VARS.vel_x, ops.mul(ops.add(fx, _keep_params), CONSTANTS.dt));
    })(),
  },
  {
    target_state: 'vel_y',
    expr: (() => {
      // Re-do the same calculation?
      // The compiler should optimize common subexpressions if we reuse the variable.
      // But here we are constructing the AST again.
      // Ideally, we should define the force vector once and refer to it.
      // But our DSL builder creates new nodes.
      // However, the compiler dedupes based on structure/hash? No.
      // The compiler maps AST nodes to variables.
      // If we want to share, we should assign the AST node to a variable in TS.
      
      const state_vec = ops.cat([
        STATE_VARS.pos_x,
        STATE_VARS.pos_y,
        STATE_VARS.vel_x,
        STATE_VARS.vel_y,
        STATE_VARS.size
      ], 1);

      const grid_state = ops.grid_scatter(state_vec, STATE_VARS.pos_x, STATE_VARS.pos_y);
      const force_grid = ops.stencil(grid_state, 1);
      const force_vec = ops.grid_gather(force_grid, STATE_VARS.pos_x, STATE_VARS.pos_y);
      
      // Extract Force Y (index 3)
      const fy = ops.slice(force_vec, 1, 3, 1);

      return ops.add(STATE_VARS.vel_y, ops.mul(fy, CONSTANTS.dt));
    })(),
  },
  
  // Keep size constant
  {
    target_state: 'size',
    expr: STATE_VARS.size,
  }
];

// 4. Visual mapping
export const VISUAL_MAPPING: VisualMapping = {
  position: {
    x: 'pos_x',
    y: 'pos_y',
  },
  size: {
    source: 'size',
    valueRange: [1, 10],
    range: [2, 20],
    scale: 'linear',
  },
};

// 5. Initialization
export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: 0, high: WORLD_SIZE_X },
    pos_y: { kind: 'uniform', low: 0, high: WORLD_SIZE_Y },
    vel_x: { kind: 'normal', mean: 0, std: 1.0 },
    vel_y: { kind: 'normal', mean: 0, std: 1.0 },
    size: { kind: 'const', value: 5.0 },
  },
  genes: { kind: 'normal', mean: 0, std: 1.0 },
};

// 6. Boundary Conditions
export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [
  { target_state: 'pos_x', kind: 'torus', range: [0, WORLD_SIZE_X] },
  { target_state: 'pos_y', kind: 'torus', range: [0, WORLD_SIZE_Y] },
];

export function extractStateVars(rules: DynamicsRule[]): string[] {
  const vars = new Set<string>();
  for (const rule of rules) {
    vars.add(rule.target_state);
  }
  return Array.from(vars).sort();
}
