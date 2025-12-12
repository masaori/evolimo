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

// Visual mapping types for simulator output visualization
export type ColorMap = 'viridis' | 'plasma' | 'heat' | 'cool' | 'custom';
export type SizeScale = 'linear' | 'sqrt' | 'log';
export type BlendMode = 'multiply' | 'add' | 'average' | 'max' | 'min';

// Single or multiple sources with optional weights
export type VisualSource = 
  | string  // Single source: state variable name
  | {
      sources: string[];  // Multiple state variables
      weights?: number[];  // Optional weights (must sum to 1.0)
      blend?: BlendMode;   // How to combine multiple sources
    };

export interface VisualMapping {
  // Position mapping (required, single source per axis)
  position: {
    x: string;  // State variable name
    y: string;  // State variable name
  };
  
  // Size mapping (optional, supports multi-source)
  size?: {
    source: VisualSource;
    range: [number, number];  // [min_radius, max_radius] in pixels
    scale?: SizeScale;
  };
  
  // Color mapping (optional, supports multi-source)
  color?: {
    source: VisualSource;
    colormap: ColorMap;
    range?: [number, number];  // Data value range for mapping
    customColors?: string[];   // Custom color palette (RGB hex)
  };
  
  // Opacity mapping (optional, supports multi-source)
  opacity?: {
    source: VisualSource;
    range: [number, number];  // [0.0, 1.0]
  };
}
