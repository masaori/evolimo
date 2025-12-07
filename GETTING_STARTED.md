# Getting Started with Evolimo

This guide will walk you through setting up and running your first evolutionary simulation.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **Rust** (1.70 or higher) - [Install via rustup](https://rustup.rs/)
- **TypeScript** - Installed automatically with npm packages

## Step 1: Clone and Setup

```bash
# Clone the repository
git clone https://github.com/masaori/evolimo.git
cd evolimo

# Install TypeScript dependencies
cd domain-model
npm install
cd ..
```

## Step 2: Define Your Physics Rules

The physics rules are defined in `domain-model/src/definition.ts`. The default configuration includes:

- **State variables**: position, velocity, energy
- **Parameter groups**: 
  - `attributes` (softmax): metabolism, movement cost
  - `physics` (tanh): drag coefficient
- **Physics rules**: velocity damping, position update, energy consumption

### Example: Adding a New State Variable

```typescript
// In definition.ts

// Add to state references
const S = {
  x: ops.state('pos_x'),
  v: ops.state('vel_x'),
  energy: ops.state('energy'),
  // NEW: Add health
  health: ops.state('health'),
};

// Add to STATE_VARS array
export const STATE_VARS = ['pos_x', 'vel_x', 'energy', 'health'];

// Add a rule for health decay
export const rules: PhysicsRule[] = [
  // ... existing rules ...
  {
    target_state: 'health',
    expr: ops.sub(S.health, ops.const(0.01))
  }
];
```

## Step 3: Compile to JSON

After modifying the physics definitions, compile them to JSON:

```bash
cd domain-model
npm run compile
```

This generates `domain-model/_gen/physics_ir.json` which is used by the Rust simulator.

You should see output like:
```
✓ Generated: .../physics_ir.json
  - State variables: 3
  - Parameter groups: 2
  - Operations: 13
```

## Step 4: Build the Simulator

The simulator automatically generates Rust code from the JSON during the build process:

```bash
cd ../simulator
cargo build --release
```

The build script (`build.rs`) reads the JSON and generates:
- `_gen_phenotype.rs` - Neural network for gene expression
- `_gen_physics.rs` - Physics update kernel

## Step 5: Run the Simulation

```bash
cargo run --release
```

You should see output like:

```
=== Evolimo Simulator ===

Using device: CUDA (or CPU)
Configuration:
  Agents: 100
  Gene length: 32
  Hidden layer: 64
  Steps per generation: 100
  Generations: 5

--- Generation 1 ---
  Step 0: avg energy = 100.04
  Step 20: avg energy = 100.86
  ...
  Avg fitness: 104.12
  Max fitness: 109.99

--- Generation 2 ---
  ...
```

## Understanding the Output

- **avg energy**: Average energy across all agents at each step
- **Avg fitness**: Average fitness of the population (based on final energy)
- **Max fitness**: Best fitness achieved by any agent

As generations progress, you should see fitness improving, indicating successful evolution!

## Customization

### Adjusting Simulation Parameters

Edit `simulator/src/main.rs`:

```rust
// Change these values
let n_agents = 100;        // Number of agents
let gene_len = 32;         // Genetic information size
let hidden_len = 64;       // Neural network hidden layer size
let n_steps = 100;         // Simulation steps per generation
let n_generations = 5;     // Number of generations
```

### Adding New Parameter Groups

In `domain-model/src/definition.ts`:

```typescript
export const GROUPS: Record<string, GroupConfig> = {
  ATTR: { name: 'attributes', activation: 'softmax' },
  PHYS: { name: 'physics', activation: 'tanh' },
  // NEW GROUP
  BEHAV: { name: 'behavior', activation: 'sigmoid' },
};

// Then use in parameters:
const P = {
  // ... existing params ...
  aggression: ops.param('aggression', GROUPS.BEHAV.name),
};
```

Available activation functions:
- `softmax` - Sum to 1.0 (good for resource allocation)
- `tanh` - Range -1.0 to 1.0 (good for bidirectional effects)
- `sigmoid` - Range 0.0 to 1.0 (good for probabilities)
- `none` - No activation (raw values)

## Troubleshooting

### "physics_ir.json not found"

Run `npm run compile` in the `domain-model` directory first.

### CUDA not available

The simulator will automatically fall back to CPU if CUDA is not available. For faster simulations, ensure you have:
- NVIDIA GPU with CUDA support
- CUDA toolkit installed

### Build fails with dependency errors

Try updating Rust:
```bash
rustup update
```

## Next Steps

- Explore `simulator/src/lifecycle.rs` for generation management
- Implement custom selection strategies
- Add visualization (the `visualizer/` directory is prepared for future work)
- Experiment with different physics rules and parameter groups

## Learn More

- [Candle ML framework](https://github.com/huggingface/candle)
- [TypeScript handbook](https://www.typescriptlang.org/docs/)
- [Genetic algorithms](https://en.wikipedia.org/wiki/Genetic_algorithm)
