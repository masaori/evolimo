// Shared utilities and common patterns for simulation definitions

import { ops } from './builder.js';
import type { BoundaryCondition, Expression } from './types.js';

/**
 * Standard constants used across simulations
 */
export const STANDARD_CONSTANTS = {
  zero: ops.const(0.0),
  one: ops.const(1.0),
  half: ops.const(0.5),
  eps: ops.const(1e-4),
} as const;

/**
 * Create torus boundary conditions for 2D world
 * @param worldSizeX - Width of the world
 * @param worldSizeY - Height of the world
 * @param centered - If true, uses [-size/2, size/2], otherwise [0, size]
 * @returns Array of boundary conditions for pos_x and pos_y
 */
export function createTorusBoundary(
  worldSizeX: number,
  worldSizeY: number,
  centered = true
): BoundaryCondition[] {
  if (centered) {
    return [
      {
        target_state: 'pos_x',
        kind: 'torus',
        range: [-worldSizeX / 2, worldSizeX / 2],
      },
      {
        target_state: 'pos_y',
        kind: 'torus',
        range: [-worldSizeY / 2, worldSizeY / 2],
      },
    ];
  }
  
  return [
      {
        target_state: 'pos_x',
        kind: 'torus',
        range: [0, worldSizeX],
      },
      {
        target_state: 'pos_y',
        kind: 'torus',
        range: [0, worldSizeY],
      },
    ];
}

/**
 * Helper to keep unused genetic parameters alive in expressions
 * This ensures PhenotypeEngine produces valid tensors even when
 * parameters aren't actively used in dynamics
 */
export function keepParamsAlive(params: Record<string, Expression>): Expression {
  const paramList = Object.values(params);
  if (paramList.length === 0) {
    return STANDARD_CONSTANTS.zero;
  }
  
  return paramList.reduce((acc, param) => 
    ops.add(acc, ops.mul(param, STANDARD_CONSTANTS.zero)),
    STANDARD_CONSTANTS.zero
  );
}
