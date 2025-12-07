# Evolimo - Evolutionary Simulation Platform

A monorepo project for evolutionary simulation with genetic algorithm-based artificial life.

## Project Structure

```
root/
├── domain-model/              # TypeScript DSL for physics rules and genetics
│   ├── src/
│   │   ├── builder.ts         # DSL core library
│   │   ├── definition.ts      # User-defined physics and genetics
│   │   └── compiler.ts        # TypeScript to JSON compiler
│   ├── _gen/                  # Generated JSON files
│   │   └── physics_ir.json    # Intermediate representation for Rust
│   └── package.json
│
├── simulator/                 # Rust simulation engine
│   ├── Cargo.toml
│   ├── build.rs               # Code generator (JSON → Rust)
│   ├── src/
│   │   ├── main.rs            # Entry point
│   │   ├── lib.rs
│   │   ├── lifecycle.rs       # Generation management
│   │   ├── _gen_phenotype.rs  # [Auto-generated] Phenotype network
│   │   └── _gen_physics.rs    # [Auto-generated] Physics kernel
│   └── scripts/
│
└── visualizer/                # (Future work)
    └── .gitkeep
```

## Workflow

1. **Define physics rules** in `domain-model/src/definition.ts` using the TypeScript DSL
2. **Compile to JSON** by running `npm run compile` in the `domain-model/` directory
3. **Build Rust simulator** which automatically generates code from the JSON during build
4. **Run simulation** with `cargo run` in the `simulator/` directory

## Features

- **Type-safe DSL** for defining physics rules and genetic parameters
- **Code generation** from high-level definitions to optimized Rust code
- **GPU acceleration** using Candle (when available)
- **Genetic algorithm** with neural network-based phenotype expression

## Getting Started

### Prerequisites

- Node.js (v18+)
- Rust (1.70+)
- TypeScript compiler

### Setup

```bash
# Install TypeScript dependencies
cd domain-model
npm install

# Compile physics definitions
npm run compile

# Build and run simulator
cd ../simulator
cargo build --release
cargo run --release
```

## License

MIT
