// DSL Core: Type-safe expression builder for physics simulation

export type ActivationType = 'softmax' | 'tanh' | 'sigmoid' | 'none';

export interface GroupConfig {
  name: string;
  activation: ActivationType;
}

// Expression AST types
export type Expression =
  | { op: 'ref_state'; id: string }
  | { op: 'ref_param'; id: string; group: string }
  | { op: 'const'; value: number }
  | { op: 'add'; left: Expression; right: Expression }
  | { op: 'sub'; left: Expression; right: Expression }
  | { op: 'mul'; left: Expression; right: Expression }
  | { op: 'div'; left: Expression; right: Expression }
  | { op: 'relu'; value: Expression }
  | { op: 'neg'; value: Expression };

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

export interface PhysicsRule {
  target_state: string;
  expr: Expression;
}

// IR (Intermediate Representation) types for JSON output
export interface OutputIR {
  state_vars: string[];
  groups: Record<
    string,
    {
      activation: ActivationType;
      params: string[];
    }
  >;
  operations: Operation[];
}

export interface Operation {
  target: string; // State variable name or intermediate variable name
  op: 'add' | 'sub' | 'mul' | 'div' | 'relu' | 'neg' | 'const' | 'ref_state' | 'ref_param';
  args?: string[]; // References to other variables (for binary ops)
  value?: number; // For const op
  param_info?: { name: string; group: string }; // For ref_param op
}
