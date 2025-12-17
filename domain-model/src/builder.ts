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
  transpose: (value: Expression, dim0 = 0, dim1 = 1): Expression => ({ op: 'transpose', value, dim0, dim1 }),
  sum: (value: Expression, dim: number, keepdim = true): Expression => ({ op: 'sum', value, dim, keepdim }),
  relu: (value: Expression): Expression => ({ op: 'relu', value }),
  neg: (value: Expression): Expression => ({ op: 'neg', value }),
} as const;
