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
  | { op: 'ref_aux'; id: string }
  | { op: 'const'; value: number }
  | { op: 'add'; left: Expression; right: Expression }
  | { op: 'sub'; left: Expression; right: Expression }
  | { op: 'mul'; left: Expression; right: Expression }
  | { op: 'div'; left: Expression; right: Expression }
  | { op: 'sqrt'; value: Expression }
  | { op: 'transpose'; value: Expression; dim0: number; dim1: number }
  | { op: 'sum'; value: Expression; dim: number; keepdim: boolean }
  | { op: 'relu'; value: Expression }
  | { op: 'neg'; value: Expression };

// Internal dynamics rule definition
export interface DynamicsRule {
  target_state: string;
  expr: Expression;
}

// Initialization distribution specs
export type Distribution =
  | { kind: 'const'; value: number }
  | { kind: 'uniform'; low: number; high: number }
  | { kind: 'normal'; mean: number; std: number };

export interface InitializationIR {
  // Per-state-var initialization (each state var is a column vector in the simulator state tensor).
  state: Record<string, Distribution>;
  // Gene vector initialization for the phenotype engine input.
  genes: Distribution;
}

// Boundary condition definitions.
export type BoundaryType = 'torus' | 'clamp' | 'none';

export interface BoundaryCondition {
  // State var name to apply boundary to (e.g. pos_x, pos_y)
  target_state: string;
  kind: BoundaryType;
  // World range [min, max]. For torus, this defines the period width (max - min).
  range: [number, number];
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
  boundary_conditions?: BoundaryCondition[];
  initialization?: InitializationIR;
  operations: Operation[];
}

export interface Operation {
  target: string; // State variable name or intermediate variable name
  op:
    | 'add'
    | 'sub'
    | 'mul'
    | 'div'
    | 'sqrt'
    | 'transpose'
    | 'sum'
    | 'relu'
    | 'neg'
    | 'const'
    | 'ref_state'
    | 'ref_param';
  args?: string[]; // References to other variables (for binary ops)
  value?: number; // For const op
  param_info?: { name: string; group: string }; // For ref_param op
  dim?: number; // For sum op
  keepdim?: boolean; // For sum op
  dim0?: number; // For transpose op
  dim1?: number; // For transpose op
}

// Visual mapping types for simulator output visualization
export type ColorMap = 'viridis' | 'plasma' | 'heat' | 'cool';
export type SizeScale = 'linear' | 'sqrt' | 'log';
export type BlendMode = 'add' | 'average' | 'max' | 'min';

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
    // Input value range used to normalize the (possibly blended) source into [0, 1].
    // If omitted, the source is assumed to already be normalized.
    valueRange?: [number, number];
    range: [number, number];  // [min_radius, max_radius] in pixels
    scale?: SizeScale;
  };
  
  // Color mapping (optional, supports multi-source)
  color?: {
    source: VisualSource;
    colormap: ColorMap;
    range?: [number, number];  // Data value range for mapping
  };
  
  // Opacity mapping (optional, supports multi-source)
  opacity?: {
    source: VisualSource;
    // Input value range used to normalize the (possibly blended) source into [0, 1].
    // If omitted, the source is assumed to already be normalized.
    valueRange?: [number, number];
    range: [number, number];  // [0.0, 1.0]
  };
}
