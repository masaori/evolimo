// Type definitions for physics domain model

// Activation function types
export type ActivationType = 'softmax' | 'tanh' | 'sigmoid' | 'none';

// Parameter group configuration
export interface GroupConfig {
  name: string;
  activation: ActivationType;
}

export interface ParameterGroups {
  readonly ATTR: GroupConfig;
  readonly PHYS: GroupConfig;
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

// Physics rule definition
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
