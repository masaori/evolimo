# Quick Start Guide

Get Evolimo up and running in 5 minutes!

## Prerequisites

- Node.js (v18+)
- Rust (1.70+)

## Installation & First Run

```bash
# 1. Clone and setup
git clone https://github.com/masaori/evolimo.git
cd evolimo/domain-model
npm install

# 2. Compile physics definitions
npm run compile

# 3. Build and run simulator
cd ../simulator
cargo run --release
```

You should see output like:

```
=== Evolimo Simulator ===
Using device: CUDA (or CPU)
...
--- Generation 1 ---
  Avg fitness: 92.93
  Max fitness: 99.64
...
--- Generation 5 ---
  Avg fitness: 98.61
  Max fitness: 99.80
```

✅ Success! Your agents are evolving!

## Modify Physics Rules

Edit `domain-model/src/definition.ts`:

```typescript
// Example: Add a new state variable
export const STATE_VARS = ['pos_x', 'vel_x', 'energy', 'age'];

const S = {
  // ... existing states ...
  age: ops.state('age'),
};

// Add rule: age increases over time
export const rules: PhysicsRule[] = [
  // ... existing rules ...
  {
    target_state: 'age',
    expr: ops.add(S.age, C.dt)
  }
];
```

After editing, recompile and rebuild:

```bash
cd domain-model
npm run compile

cd ../simulator
cargo build --release
cargo run --release
```

## Next Steps

- 📖 Read [GETTING_STARTED.md](./GETTING_STARTED.md) for detailed examples
- 🏗️ Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system
- 🔧 Experiment with different parameter groups and activations
- 🎨 (Future) Add visualization in the `visualizer/` directory

## Common Commands

```bash
# Domain model
cd domain-model
npm run build          # Just compile TypeScript
npm run compile        # Compile + generate JSON
npm run watch          # Auto-recompile on changes

# Simulator
cd simulator
cargo build            # Debug build
cargo build --release  # Optimized build
cargo run --release    # Build and run
```

## Troubleshooting

**"physics_ir.json not found"**
→ Run `npm run compile` in `domain-model/` first

**"CUDA not available"**
→ Normal! Simulator automatically uses CPU

**Build errors after changing rules**
→ Try `cargo clean` then `cargo build --release`

## Key Files

- `domain-model/src/definition.ts` - Define your physics here
- `simulator/src/main.rs` - Adjust simulation parameters
- `simulator/src/lifecycle.rs` - Customize selection strategy

Happy evolving! 🧬
