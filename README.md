# Evolimo - Evolution Simulator

TypeScript定義からRustコードを自動生成する生物進化シミュレーター (Monorepo)

## プロジェクト構成

```
evolimo/
├── domain-model/      # TypeScript DSL定義層
├── simulator/         # Rust高性能シミュレーション層
└── visualizer/        # 可視化層
```

## Quick Start

### 1. Domain Model (TypeScript定義)

```bash
cd domain-model
npm install
npm run build        # physics_ir.json生成
npm run fmt          # フォーマット
npm run check-types  # 型チェック
```

### 2. Simulator (Rustシミュレーション)

```bash
cd simulator
cargo build          # JSONからRustコード生成 & ビルド
cargo run -- --max-sim-frames 600  # シミュレーション実行 (例)
cargo fmt            # フォーマット
cargo clippy         # リント
```

- `--max-sim-frames`を省略すると無限ループで実行します (Ctrl+Cで停止)
- 出力は `simulator/sim_output.evo`

### 3. Visualizer (可視化)

```bash
cd visualizer
cargo run -- \
	--sim-fps 60 \
	--input ../simulator/sim_output.evo \
	--mapping ../domain-model/_gen/visual_mapping.json
```

## アーキテクチャ

1. **TypeScript DSL** で物理法則・遺伝子構造を定義
2. **Compiler** がJSON中間表現 (IR) を生成
3. **build.rs** がJSONからRustコードを自動生成
4. **candle** テンソルライブラリでGPU並列シミュレーション

詳細は [PLAN.md](./PLAN.md) を参照。

## Requirements

- Node.js 18+
- Rust 1.70+
- (Optional) CUDA for GPU acceleration
