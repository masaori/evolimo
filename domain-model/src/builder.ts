// DSL Core: Type-safe expression builder for physics simulation

import type { Expression } from './types.js';

// Type-safe operation builders
export const ops = {
  state: (id: string): Expression => ({ op: 'ref_state', id }),
  param: (id: string, group: string): Expression => ({ op: 'ref_param', id, group }),
  const: (value: number): Expression => ({ op: 'const', value }),

  add: (left: Expression, right: Expression): Expression => ({ op: 'add', left, right }),
  sub: (left: Expression, right: Expression): Expression => ({ op: 'sub', left, right }),
  mul: (left: Expression, right: Expression): Expression => ({ op: 'mul', left, right }),
  div: (left: Expression, right: Expression): Expression => ({ op: 'div', left, right }),
  relu: (value: Expression): Expression => ({ op: 'relu', value }),
  neg: (value: Expression): Expression => ({ op: 'neg', value }),
} as const;
