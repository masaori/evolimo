// Example: Conditional Logic using where/gt/lt/ge

import { ops } from '../builder.js';
import type {
  BoundaryCondition,
  DynamicsRule,
  GroupConfig,
  InitializationIR,
  ParameterGroups,
  VisualMapping,
} from '../types.js';

export const SIM_CONSTANTS = {
  n_agents: 100,
  gene_len: 10,
  hidden_len: 10,
};

const WORLD_SIZE = 1000.0;

export const PARAMETER_GROUPS: ParameterGroups = {
  ATTR: { name: 'attributes', activation: 'softmax' } satisfies GroupConfig,
  PHYS: { name: 'physics', activation: 'tanh' } satisfies GroupConfig,
};

const GENETIC_PARAMS = {
  dummy_attr: ops.param('dummy_attr', PARAMETER_GROUPS.ATTR.name),
  dummy_phys: ops.param('dummy_phys', PARAMETER_GROUPS.PHYS.name),
} as const;

const STATE_VARS = {
  pos_x: ops.state('pos_x'),
  pos_y: ops.state('pos_y'),
  vel_x: ops.state('vel_x'),
  vel_y: ops.state('vel_y'),
  color: ops.state('color'), // 0 or 1
} as const;

export const STATE_VAR_ORDER: (keyof typeof STATE_VARS)[] = [
  'pos_x',
  'pos_y',
  'vel_x',
  'vel_y',
  'color',
];

export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: -WORLD_SIZE / 2, high: WORLD_SIZE / 2 },
    pos_y: { kind: 'uniform', low: -WORLD_SIZE / 2, high: WORLD_SIZE / 2 },
    vel_x: { kind: 'normal', mean: 0.0, std: 10.0 },
    vel_y: { kind: 'normal', mean: 0.0, std: 10.0 },
    size: { kind: 'uniform', low: 1.0, high: 10.0},
  },
  genes: { kind: 'normal', mean: 0.0, std: 1.0 },
};

export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [
  { target_state: 'pos_x', kind: 'torus', range: [-WORLD_SIZE/2, WORLD_SIZE/2] },
  { target_state: 'pos_y', kind: 'torus', range: [-WORLD_SIZE/2, WORLD_SIZE/2] },
];

const CONSTANTS = {
  dt: ops.const(0.1),
  zero: ops.const(0.0),
  one: ops.const(1.0),
  threshold: ops.const(0.0),
};

export const DYNAMICS_RULES: DynamicsRule[] = [
  // pos += vel * dt
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, ops.mul(STATE_VARS.vel_x, CONSTANTS.dt)),
  },
  {
    target_state: 'pos_y',
    expr: ops.add(STATE_VARS.pos_y, ops.mul(STATE_VARS.vel_y, CONSTANTS.dt)),
  },
  // vel remains constant (inertia)
  {
    target_state: 'vel_x',
    expr: STATE_VARS.vel_x,
  },
  {
    target_state: 'vel_y',
    expr: STATE_VARS.vel_y,
  },
  // Color depends on position: if x > 0 then 1 else 0
  {
    target_state: 'size',
    expr: ops.add(
      ops.where(ops.gt(STATE_VARS.pos_x, CONSTANTS.threshold), CONSTANTS.one, CONSTANTS.zero),
      ops.add(
        ops.mul(GENETIC_PARAMS.dummy_phys, CONSTANTS.zero),
        ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)
      )
    ),
  },
];

export const VISUAL_MAPPING: VisualMapping = {
  position: { x: 'pos_x', y: 'pos_y' },
  size: {
    source: 'size',
    valueRange: [0, 100],
    range: [5, 100],
    scale: 'linear',
  },
  color: {
    source: 'pos_x',
    colormap: 'plasma',
    range: [-WORLD_SIZE / 2, WORLD_SIZE / 2],
  },
};
