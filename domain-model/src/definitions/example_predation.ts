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
  size: ops.state('size'),
} as const;

export const STATE_VAR_ORDER: (keyof typeof STATE_VARS)[] = [
  'pos_x',
  'pos_y',
  'vel_x',
  'vel_y',
  'size',
];

export const INITIALIZATION: InitializationIR = {
  state: {
    pos_x: { kind: 'uniform', low: -WORLD_SIZE / 2, high: WORLD_SIZE / 2 },
    pos_y: { kind: 'uniform', low: -WORLD_SIZE / 2, high: WORLD_SIZE / 2 },
    vel_x: { kind: 'normal', mean: 0.0, std: 2.0 },
    vel_y: { kind: 'normal', mean: 0.0, std: 2.0 },
    size: { kind: 'uniform', low: 1.0, high: 10.0 },
  },
  genes: { kind: 'normal', mean: 0.0, std: 1.0 },
};

export const BOUNDARY_CONDITIONS: BoundaryCondition[] = [
  { target_state: 'pos_x', kind: 'torus', range: [-WORLD_SIZE/2, WORLD_SIZE/2] },
  { target_state: 'pos_y', kind: 'torus', range: [-WORLD_SIZE/2, WORLD_SIZE/2] },
];

const CONSTANTS = {
  zero: ops.const(0.0),
  one: ops.const(1.0),
};

const INTERACTION_RANGE = 50.0; // 相互作用する距離

export const DYNAMICS_RULES: DynamicsRule[] = [
  // -------------------------------------------------
  // Movement: 等速直線運動 (Constant Velocity)
  // -------------------------------------------------
  {
    target_state: 'pos_x',
    expr: ops.add(STATE_VARS.pos_x, STATE_VARS.vel_x),
  },
  {
    target_state: 'pos_y',
    expr: ops.add(STATE_VARS.pos_y, STATE_VARS.vel_y),
  },
  {
    target_state: 'vel_x',
    // 加速なし。現在の速度をそのまま維持 (Identity)
    expr: ops.add(STATE_VARS.vel_x, ops.mul(GENETIC_PARAMS.dummy_phys, CONSTANTS.zero)),
  },
  {
    target_state: 'vel_y',
    // 加速なし。現在の速度をそのまま維持 (Identity)
    expr: ops.add(STATE_VARS.vel_y, ops.mul(GENETIC_PARAMS.dummy_attr, CONSTANTS.zero)),
  },

  // -------------------------------------------------
  // Interaction: サイズの奪い合い (Predation)
  // -------------------------------------------------
  {
    target_state: 'size',
    expr: (() => {
      const x = STATE_VARS.pos_x;
      const y = STATE_VARS.pos_y;
      const s = STATE_VARS.size;

      // --- 1. 全対全のペアを作る (Broadcasting) ---
      // shape: (N, 1)
      // xT, yT, sT shape: (1, N)
      const xT = ops.transpose(x, 0, 1);
      const yT = ops.transpose(y, 0, 1);
      const sT = ops.transpose(s, 0, 1); // 相手(j)のサイズ

      // --- 2. 距離マスク (Distance Mask) ---
      const dx = ops.sub(x, xT); // x_i - x_j (あえて転置を逆にして N x N に広げる)
      const dy = ops.sub(y, yT);
      const d2 = ops.add(ops.mul(dx, dx), ops.mul(dy, dy));
      const range_sq = ops.const(INTERACTION_RANGE * INTERACTION_RANGE);
      
      // 距離が範囲内なら 1.0, それ以外は 0.0
      // Mask_dist[i, j] = 1 if dist(i, j) < range
      const mask_dist = ops.where(ops.lt(d2, range_sq), CONSTANTS.one, CONSTANTS.zero);

      // --- 3. サイズ優位マスク (Dominance Mask) ---
      // 条件: 自分のサイズ(s) >= 相手のサイズ(sT) * 2
      // Mask_dom[i, j] = 1 if s_i >= 2 * s_j
      const double_target_size = ops.mul(sT, ops.const(2.0));
      const mask_dom = ops.where(ops.ge(s, double_target_size), CONSTANTS.one, CONSTANTS.zero);

      // --- 4. 相互作用マスク (Interaction Mask) ---
      // 両方の条件を満たす場合のみ 1.0 (AND演算の代わりに乗算)
      // Mask_final[i, j]
      const mask_interaction = ops.mul(mask_dist, mask_dom);

      // --- 5. 移動量の計算 (Transfer Amount) ---
      // 奪う量: 相手のサイズ(sT)の半分
      // Amount[i, j] = Mask[i, j] * (s_j * 0.5)
      const amount_matrix = ops.mul(
        mask_interaction,
        ops.mul(sT, ops.const(0.5))
      );

      // --- 6. 収支計算 (Balance) ---
      
      // Gain: 自分が奪った総量
      // Row sum: sum_j (Amount[i, j]) -> shape (N, 1)
      const gain = ops.sum(amount_matrix, 1, true);

      // Loss: 自分が奪われた総量
      // Col sum: sum_i (Amount[i, j])
      // テンソル操作の都合上、「Amount行列を転置してRow sumをとる」のが安全
      const amount_T = ops.transpose(amount_matrix, 0, 1);
      const loss = ops.sum(amount_T, 1, true);

      // --- 7. 更新 (Update) ---
      // size_new = size + gain - loss
      return ops.sub(ops.add(s, gain), loss);
    })(),
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
    source: 'size',
    colormap: 'viridis',
    range: [0, 50],
  },
};
