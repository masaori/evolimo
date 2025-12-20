// Universal Gravitation with Fixed-Capacity Grid based computation
// Combines the physics from universal_gravitation.ts with grid-based neighbor calculation

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
  n_agents: 10000,
  gene_len: 32,
  hidden_len: 64,
};

const WORLD_SIZE_X = 10240.0;
const WORLD_SIZE_Y = 8000.0;

// Grid Configuration
// 10240 / 128 = 80 cells
// 8000 / 125 = 64 cells
// With 1000 agents over 5120 cells, average density is ~0.2 agents/cell
// Capacity of 8 should be more than sufficient
export const GRID_CONFIG: GridConfig = {
  width: 80,
  height: 64,
  capacity: 8,
  cell_size: [128.0, 125.0],
};

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
  zero: ops.const(0.0),
} as const;

// Canonical state ordering used for the simulator state tensor.
export const STATE_VAR_ORDER: (keyof typeof STATE_VARS)[] = ['pos_x', 'pos_y', 'vel_x', 'vel_y', 'size'];

// 3. Initialization configuration
export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: -200.0, high: 200.0 },
    pos_y: { kind: 'uniform', low: -200.0, high: 200.0 },
    vel_x: { kind: 'normal', mean: 0.0, std: 10.0 },
    vel_y: { kind: 'normal', mean: 0.0, std: 10.0 },
    size: { kind: 'uniform', low: 1.0, high: 10.0 },
  },
  genes: { kind: 'normal', mean: 0.0, std: 1.0 },
};

// 4. Boundary conditions (Torus wrapping)
export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [
  {
    target_state: 'pos_x',
    kind: 'torus',
    range: [-WORLD_SIZE_X / 2, WORLD_SIZE_X / 2],
  },
  {
    target_state: 'pos_y',
    kind: 'torus',
    range: [-WORLD_SIZE_Y / 2, WORLD_SIZE_Y / 2],
  },
];

// 5. Dynamics rules using Grid Stencil computation
export const DYNAMICS_RULES: DynamicsRule[] = [
  // Position update: pos += vel * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, STATE_VARS.vel_x),
  },
  {
    target_state: 'pos_y',
    expr: ops.add(STATE_VARS.pos_y, STATE_VARS.vel_y),
  },

  // Velocity X update using Grid Stencil
  {
    target_state: 'vel_x',
    expr: (() => {
      // 1. Prepare state tensor for grid: [pos_x, pos_y, vel_x, vel_y, size]
      const state_vec = ops.cat([
        STATE_VARS.pos_x,
        STATE_VARS.pos_y,
        STATE_VARS.vel_x,
        STATE_VARS.vel_y,
        STATE_VARS.size
      ], 1);

      // 2. Scatter particles to Grid → [H, W, Cap, 5]
      const grid_state = ops.grid_scatter(state_vec, STATE_VARS.pos_x, STATE_VARS.pos_y);

      // 3. Compute Stencil Interactions (Gravity)
      // Uses 3x3 neighborhood (stencil_range = 1)
      // Returns grid with forces in vel slots (indices 2 and 3)
      const force_grid = ops.stencil(grid_state, 1);

      // 4. Gather forces back to particles → [N, 5]
      const force_vec = ops.grid_gather(force_grid, STATE_VARS.pos_x, STATE_VARS.pos_y);

      // 5. Extract Force X (index 2)
      const fx = ops.slice(force_vec, 1, 2, 1);

      // Keep params alive to ensure PhenotypeEngine produces valid tensors
      const _keep_params = ops.add(
        ops.mul(GENETIC_PARAMS.grav_g, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      );

      // Update vel_x: vel_x += fx * dt
      return ops.add(STATE_VARS.vel_x, ops.add(fx, _keep_params));
    })(),
  },

  // Velocity Y update using Grid Stencil
  {
    target_state: 'vel_y',
    expr: (() => {
      // Same grid computation (compiler should optimize if possible)
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

      // Keep params alive
      const _keep_params = ops.add(
        ops.mul(GENETIC_PARAMS.grav_g, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      );

      // Update vel_y: vel_y += fy * dt
      return ops.add(STATE_VARS.vel_y, ops.add(fy, _keep_params));
    })(),
  },

  // Size remains constant
  {
    target_state: 'size',
    expr: STATE_VARS.size,
  },
];

// 6. Visual mapping configuration
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

// Extract state variable names from rules
export function extractStateVars(rules: DynamicsRule[]): string[] {
  const vars = new Set<string>();
  for (const rule of rules) {
    vars.add(rule.target_state);
  }
  return Array.from(vars).sort();
}
