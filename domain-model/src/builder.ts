/**
 * DSL Core for defining physics rules and genetic parameters
 */

// Activation function types for parameter groups
export type ActivationType = 'softmax' | 'tanh' | 'sigmoid' | 'none';

// Configuration for a parameter group
export interface GroupConfig {
  name: string;
  activation: ActivationType;
}

// Expression tree for physics operations
export type Expression = 
  | { op: 'ref_state', id: string }
  | { op: 'ref_param', id: string, group: string }
  | { op: 'const', value: number }
  | { op: 'add', left: Expression, right: Expression }
  | { op: 'sub', left: Expression, right: Expression }
  | { op: 'mul', left: Expression, right: Expression }
  | { op: 'div', left: Expression, right: Expression }
  | { op: 'relu', value: Expression };

// DSL helper functions for building expressions
export const ops = {
  // Reference to a state variable
  state: (id: string): Expression => ({ op: 'ref_state', id }),
  
  // Reference to a parameter (must belong to a group)
  param: (id: string, group: string): Expression => ({ op: 'ref_param', id, group }),
  
  // Constant value
  const: (val: number): Expression => ({ op: 'const', value: val }),
  
  // Arithmetic operations
  add: (a: Expression, b: Expression): Expression => ({ op: 'add', left: a, right: b }),
  sub: (a: Expression, b: Expression): Expression => ({ op: 'sub', left: a, right: b }),
  mul: (a: Expression, b: Expression): Expression => ({ op: 'mul', left: a, right: b }),
  div: (a: Expression, b: Expression): Expression => ({ op: 'div', left: a, right: b }),
  
  // Activation functions
  relu: (value: Expression): Expression => ({ op: 'relu', value }),
};

// Physics rule definition
export interface PhysicsRule {
  target_state: string;
  expr: Expression;
}
