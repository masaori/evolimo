// DSL Core: Type-safe expression builder for physics simulation

import type { Expression } from './types.js';

// Type-safe operation builders
export const ops = {
  state: (id: string): Expression => ({ op: 'ref_state', id }),
  param: (id: string, group: string): Expression => ({ op: 'ref_param', id, group }),
  aux: (id: string): Expression => ({ op: 'ref_aux', id }),
  const: (value: number): Expression => ({ op: 'const', value }),

  add: (left: Expression, right: Expression): Expression => ({ op: 'add', left, right }),
  sub: (left: Expression, right: Expression): Expression => ({ op: 'sub', left, right }),
  mul: (left: Expression, right: Expression): Expression => ({ op: 'mul', left, right }),
  div: (left: Expression, right: Expression): Expression => ({ op: 'div', left, right }),
  sqrt: (value: Expression): Expression => ({ op: 'sqrt', value }),
  transpose: (value: Expression, dim0 = 0, dim1 = 1): Expression => ({
    op: 'transpose',
    value,
    dim0,
    dim1,
  }),
  sum: (value: Expression, dim: number, keepdim = true): Expression => ({
    op: 'sum',
    value,
    dim,
    keepdim,
  }),
  relu: (value: Expression): Expression => ({ op: 'relu', value }),
  neg: (value: Expression): Expression => ({ op: 'neg', value }),

  // Grid operations
  grid_scatter: (value: Expression, x: Expression, y: Expression): Expression => ({
    op: 'grid_scatter',
    value,
    x,
    y,
  }),
  stencil: (value: Expression, range: number): Expression => ({ op: 'stencil', value, range }),
  grid_gather: (value: Expression, x: Expression, y: Expression): Expression => ({
    op: 'grid_gather',
    value,
    x,
    y,
  }),

  // Tensor manipulation
  cat: (values: Expression[], dim: number): Expression => ({ op: 'cat', values, dim }),
  slice: (value: Expression, dim: number, start: number, len: number): Expression => ({
    op: 'slice',
    value,
    dim,
    start,
    len,
  }),

  // Comparison
  lt: (left: Expression, right: Expression): Expression => ({ op: 'lt', left, right }),
  gt: (left: Expression, right: Expression): Expression => ({ op: 'gt', left, right }),
  ge: (left: Expression, right: Expression): Expression => ({ op: 'ge', left, right }),

  // Conditional
  where: (cond: Expression, trueVal: Expression, falseVal: Expression): Expression => ({
    op: 'where',
    cond,
    trueVal,
    falseVal,
  }),
} as const;
