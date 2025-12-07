# Evolimo Architecture

This document describes the technical architecture and design decisions of the Evolimo project.

## Overview

Evolimo is a code-generation-based evolutionary simulation framework that allows users to define physics rules in a high-level TypeScript DSL, which are then compiled to optimized Rust code for GPU-accelerated execution.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                   User Definition Layer                  │
│           (TypeScript DSL - definition.ts)               │
└─────────────────────┬───────────────────────────────────┘
                      │ npm run compile
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Intermediate Representation                 │
│                   (physics_ir.json)                      │
└─────────────────────┬───────────────────────────────────┘
                      │ build.rs (code generation)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                Generated Rust Code                       │
│         (_gen_phenotype.rs, _gen_physics.rs)            │
└─────────────────────┬───────────────────────────────────┘
                      │ cargo build
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Compiled Binary Simulator                   │
│              (GPU-accelerated execution)                 │
└─────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Domain Model Layer (`domain-model/`)

**Purpose**: Provide a type-safe DSL for defining physics rules and genetic parameters.

#### `src/builder.ts` - DSL Core

Defines the fundamental types and operations:

- **Expression tree**: Represents mathematical operations as an AST
- **GroupConfig**: Defines parameter groups with activation functions
- **Operations**: Mathematical operators (add, sub, mul, div, relu)

Key design decisions:
- Immutable expression trees for safe composition
- Type-safe parameter references with group membership
- Support for both state variables and learnable parameters

#### `src/definition.ts` - User Configuration

Where users define:
- State variables (e.g., position, velocity, energy)
- Parameter groups (e.g., attributes, physics)
- Physics update rules

Example structure:
```typescript
const rules: PhysicsRule[] = [
  {
    target_state: 'vel_x',
    expr: ops.sub(S.v, ops.mul(ops.mul(S.v, P.drag), C.dt))
  }
];
```

#### `src/compiler.ts` - Code Generator

Transforms the DSL into JSON IR:

1. **Parameter Collection**: Scans all rules to find parameters
2. **Group Organization**: Assigns parameters to their respective groups
3. **Expression Flattening**: Converts expression trees to linear operations
4. **Index Assignment**: Determines parameter order for tensor indexing

Output format:
```json
{
  "state_vars": ["pos_x", "vel_x", "energy"],
  "groups": {
    "attributes": {
      "activation": "softmax",
      "params": ["metabolism", "move_cost"]
    }
  },
  "operations": [...]
}
```

### 2. Simulator Layer (`simulator/`)

**Purpose**: Execute the simulation with GPU acceleration using generated code.

#### `build.rs` - Build-time Code Generator

Runs during `cargo build` to generate Rust code from JSON IR:

**Generation steps**:

1. Read `physics_ir.json`
2. Generate phenotype engine:
   - Neural network structure
   - Activation functions per group
   - Forward pass implementation
3. Generate physics kernel:
   - State variable extraction
   - Parameter extraction by group
   - Operation application
   - State concatenation

**Key optimizations**:
- Zero-copy tensor operations
- Batch processing for all agents
- GPU-friendly memory layout

#### `src/lib.rs` - Library Interface

Includes generated modules and exports public APIs:
```rust
mod gen_phenotype {
    include!(concat!(env!("OUT_DIR"), "/_gen_phenotype.rs"));
}
```

#### `src/lifecycle.rs` - Generation Management

Handles:
- Generation tracking
- Fitness calculation
- Parent selection (tournament selection)
- Population management

#### `src/main.rs` - Simulation Loop

Main execution flow:

```rust
for generation in 0..n_generations {
    // 1. Gene expression (Genotype → Phenotype)
    let params = phenotype_engine.forward(&genes)?;
    
    for step in 0..n_steps {
        // 2. Physics update (State + Params → New State)
        state = update_physics(&state, &params.attributes, &params.physics)?;
    }
    
    // 3. Selection and reproduction
    let parents = generation.select_parents(n_parents);
    genes = reproduce(&genes, &parents)?;
}
```

## Data Flow

### Gene Expression Pipeline

```
Random Genes (N × 32)
    ↓
Base Network (Linear + ReLU) → Latent (N × 64)
    ↓
┌───────────┬──────────────┐
│           │              │
Head 1      Head 2         Head N
↓           ↓              ↓
Softmax     Tanh          Sigmoid
↓           ↓              ↓
Params 1    Params 2      Params N
(N × P1)    (N × P2)      (N × PN)
```

### Physics Update Pipeline

```
State (N × S)    Parameters (N × P)
    ↓                    ↓
Extract variables    Extract params
    ↓                    ↓
    └──────┬──────────────┘
           ↓
    Apply operations
    (flattened expression tree)
           ↓
    Concatenate results
           ↓
    New State (N × S)
```

## Design Decisions

### Why Code Generation?

**Pros**:
- Zero runtime overhead for physics rules
- Compile-time type checking
- Optimal memory layout
- Easy to inspect generated code

**Cons**:
- Requires rebuild when rules change
- More complex build process

**Alternative considered**: Dynamic interpretation
- Would allow runtime rule changes but with significant performance cost

### Why TypeScript for DSL?

**Pros**:
- Strong type system for safety
- Familiar syntax for many developers
- Good tooling (LSP, formatting, etc.)
- Easy JSON serialization

**Cons**:
- Requires Node.js toolchain

**Alternative considered**: Rust macros
- Would simplify toolchain but reduce flexibility and increase complexity

### Why Candle?

**Pros**:
- Pure Rust (no Python dependency)
- GPU acceleration support
- Minimal abstraction over tensors
- Good performance

**Cons**:
- Less mature than PyTorch
- Smaller ecosystem

## Performance Considerations

### Tensor Operations

All physics operations use broadcast semantics:
```rust
let result = a.broadcast_mul(&b)?;  // Efficient for (N×1) × (N×1)
```

### Memory Layout

State stored as contiguous tensor:
```
[pos_x_0, vel_x_0, energy_0, pos_x_1, vel_x_1, energy_1, ...]
 ← agent 0 →         ← agent 1 →
```

Extracted as views (zero-copy):
```rust
let pos = state.narrow(1, 0, 1)?;  // No allocation
```

### GPU Utilization

- All agents processed in parallel
- Batch operations for efficiency
- Automatic fallback to CPU when CUDA unavailable

## Extension Points

### Adding New Activation Functions

1. Add to `ActivationType` in `builder.ts`
2. Update code generation in `build.rs`:
   ```rust
   "new_activation" => code.push_str(&format!("let val = custom_fn(&raw)?;\n")),
   ```

### Adding New Operations

1. Add to `Expression` type in `builder.ts`
2. Add helper in `ops` object
3. Update flattening in `compiler.ts`
4. Update code generation in `build.rs`

### Custom Selection Strategies

Modify `lifecycle.rs`:
```rust
impl Generation {
    pub fn select_parents_custom(&self, n: usize) -> Vec<usize> {
        // Your strategy here
    }
}
```

## Testing Strategy

### Unit Tests (TODO)

- DSL expression building
- Compiler correctness
- Physics operation equivalence

### Integration Tests (TODO)

- Full compilation pipeline
- Simulator execution
- Fitness calculation

### Property Tests (TODO)

- Energy conservation
- Genetic inheritance
- Population stability

## Future Improvements

1. **Visualizer**: Real-time 2D/3D visualization
2. **Persistence**: Save/load simulation state
3. **Distributed**: Multi-GPU support
4. **Analysis**: Built-in metrics and plotting
5. **Interactive**: Runtime parameter adjustment
6. **Extended DSL**: Conditional rules, interactions between agents

## References

- [Candle documentation](https://github.com/huggingface/candle)
- [Expression trees](https://en.wikipedia.org/wiki/Binary_expression_tree)
- [Genetic algorithms](https://en.wikipedia.org/wiki/Genetic_algorithm)
- [Code generation patterns](https://en.wikipedia.org/wiki/Metacompilation)
